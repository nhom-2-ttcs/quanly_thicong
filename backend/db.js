const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || 'quanly_thicong',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool.promise();
