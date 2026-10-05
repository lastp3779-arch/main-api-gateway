const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint اختبارية للتأكد من تشغيل Gateway
app.get('/', (req, res) => {
  res.json({ 
    status: "ON", 
    message: "API Gateway is running successfully" 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gateway listening on port ${PORT}`);
});
