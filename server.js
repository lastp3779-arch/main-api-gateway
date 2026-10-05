const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// إعداد الاتصال بقاعدة البيانات
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// للسماح للسيرفر بقراءة البيانات المرسلة بصيغة JSON
app.use(express.json());

// 1. مسار الفحص الرئيسي
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: "ON",
      message: "API Gateway is running & connected to Supabase successfully!",
      db_time: result.rows[0].now
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. مسار تسجيل مستخدم جديد وإنشاء محفظته
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "البريد الإلكتروني وكلمة المرور مطلوبان" });
  }

  const client = await pool.connect();

  try {
    // بدء معاملة (Transaction) لضمان تنفيذ إنشاء المستخدم والمحفظة معاً
    await client.query('BEGIN');

    // أ) إدخال المستخدم الجديد
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, password] // ملاحظة: سيتم إضافة التشفير لاحقاً لزيادة الأمان
    );
    const userId = userResult.rows[0].id;

    // ب) إنشاء محفظة رقمية (USDT) للمستخدم برصيد 0
    const walletResult = await client.query(
      'INSERT INTO wallets (user_id, currency, balance) VALUES ($1, $2, $3) RETURNING id, balance, currency',
      [userId, 'USDT', 0.00000000]
    );

    // اعتماد التغييرات في قاعدة البيانات
    await client.query('COMMIT');

    res.status(201).json({
      message: "تم إنشاء الحساب والمحفظة بنجاح!",
      userId: userId,
      wallet: walletResult.rows[0]
    });

  } catch (err) {
    // في حال حدوث أي خطأ، يتم التراجع عن كل شيء لعدم إنشاء بيانات ناقصة
    await client.query('ROLLBACK');
    console.error('Registration Error:', err);
    res.status(500).json({ error: "فشل في تسجيل الحساب", details: err.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
