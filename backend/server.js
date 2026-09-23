const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// API kiem tra trang thai server
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend quan ly thi cong dang hoat dong' });
});

// API kiem tra ket noi database
app.get('/api/db-check', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 + 1 AS solution');
    res.json({ status: 'Connected', data: rows });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
});

// Endpoint cho chuc nang dang nhap (de ban lam Sprint S-02 viet tiep)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  // TODO: Sprint S-02 xu ly xac thuc o day
  res.json({ message: 'Ready for Sprint S-02 implementation' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
