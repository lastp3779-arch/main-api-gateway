const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_key'; 

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());

// دالة التحقق من مفتاح الدخول (JWT Middleware)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "غير مصرح: يجب تقديم توكين الدخول" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "التوكين غير صالحة أو منتهية الصلاحية" });
    }
    req.user = user;
    next();
  });
}

// 1. مسار الفحص
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: "ON", message: "Gateway is Secure & Connected!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. إنشاء حساب مشفر ومحفظة
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "البيانات ناقصة" });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userResult = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, hashedPassword]
    );
    const userId = userResult.rows[0].id;

    await client.query(
      'INSERT INTO wallets (user_id, currency, balance) VALUES ($1, $2, $3)',
      [userId, 'USDT', 0.00000000]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: "تم التسجيل وإنشاء المحفظة بأمان!", userId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "فشل التسجيل، قد يكون البريد مستخدماً" });
  } finally {
    client.release();
  }
});

// 3. تسجيل الدخول وإصدار Token
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "البريد أو كلمة المرور غير صحيحة" });
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "البريد أو كلمة المرور غير صحيحة" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: "تم تسجيل الدخول بنجاح", token });
  } catch (err) {
    res.status(500).json({ error: "خطأ في السيرفر" });
  }
});

// 4. قراءة رصيد المحفظة
app.get('/balance', authenticateToken, async (req, res) => {
  try {
    const walletResult = await pool.query(
      'SELECT id as wallet_id, balance, currency, created_at FROM wallets WHERE user_id = $1',
      [req.user.userId]
    );

    if (walletResult.rows.length === 0) {
      return res.status(404).json({ error: "المحفظة غير موجودة" });
    }

    res.json({
      message: "تم جلب بيانات المحفظة بنجاح",
      wallet: walletResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: "خطأ في قراءة بيانات المحفظة" });
  }
});

// 5. التحويل المالي الآمن بين المحافظ
app.post('/transfer', authenticateToken, async (req, res) => {
  const { recipientEmail, amount } = req.body;
  const senderUserId = req.user.userId;

  const transferAmount = parseFloat(amount);
  if (isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error: "مبلغ التحويل غير صالح" });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // أ) جلب بيانات المرسل والتأكد من وجود رصيد كافٍ مع قفل السطر للتعديل
    const senderWalletResult = await client.query(
      'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [senderUserId]
    );

    if (senderWalletResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "محفظة المرسل غير موجودة" });
    }

    const currentBalance = parseFloat(senderWalletResult.rows[0].balance);
    if (currentBalance < transferAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "الرصيد غير كافٍ لإتمام العملية" });
    }

    // ب) البحث عن المستلم
    const recipientUserResult = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [recipientEmail]
    );

    if (recipientUserResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "حساب المستلم غير موجود" });
    }

    const recipientUserId = recipientUserResult.rows[0].id;

    if (recipientUserId === senderUserId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "لا يمكنك التحويل لنفس المحفظة" });
    }

    // ج) خصم المبلغ من المرسل
    await client.query(
      'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
      [transferAmount, senderUserId]
    );

    // د) إضافة المبلغ للمستلم
    await client.query(
      'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
      [transferAmount, recipientUserId]
    );

    await client.query('COMMIT');

    res.json({
      message: "تم التحويل بنجاح!",
      transferredAmount: transferAmount,
      recipient: recipientEmail
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "فشلت عملية التحويل", details: err.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
