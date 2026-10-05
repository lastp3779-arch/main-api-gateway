const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// إعداد الاتصال بقاعدة البيانات عبر الـ Pooler
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // مطلوب لتشفير SSL مع سحابة Supabase
  }
});

app.use(express.json());

// مسار الفحص الرئيسي والتأكد من الاتصال بقاعدة البيانات
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: "ON",
      message: "API Gateway is running & connected to Supabase successfully!",
      db_time: result.rows[0].now
    });
  } catch (err) {
    console.error('Database Connection Error:', err);
    res.status(500).json({
      status: "ERROR",
      message: "Failed to connect to Supabase Database",
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
