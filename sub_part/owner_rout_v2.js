const express = require('express');
const mysql = require('mysql2');
require('dotenv').config();
const router = express.Router();



const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {}
}).promise();




router.get('/all-data', async (req, res) => {
  try {
    // Use `await` to ensure the queries are completed before proceeding.
    const [admins] = await db.query('SELECT * FROM admins');
    const [owners] = await db.query('SELECT * FROM owner');
    const [clients] = await db.query('SELECT * FROM clients');
    const [packages] = await db.query('SELECT * FROM packages');
    // const [totalExpense] = await db.query(`SELECT * FROM 'toatl expense'`);

    // Send the JSON response once data is fetched.
    res.json({
      totalAdmins: admins.length,
      totalOwners: owners.length,
      totalClients: clients.length,
      totalPackages: packages.length,
      // totalExpenses: totalExpense.length,
      admins: admins,
      owners: owners,
      clients: clients,
      packages: packages,
      expenses: totalExpense
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;