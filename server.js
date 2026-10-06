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

// 1. مسار الفحص الرئيسية
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

    // تشفير كلمة المرور
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

    // إصدار Token صالح لمدة 7 أيام
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ message: "تم تسجيل الدخول بنجاح", token });
  } catch (err) {
    res.status(500).json({ error: "خطأ في السيرفر" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
