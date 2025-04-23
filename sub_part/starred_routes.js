const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
require('dotenv').config();



const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
});

router.put('/drive/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const { is_starred } = req.body;
    console.log("for starring message", type, id, is_starred);

    if (type !== 'files' && type !== 'folders') {
        return res.status(400).json({ error: 'Invalid item type' });
    }

    const tableName = type === 'files' ? 'drive_files' : 'drive_folders';
    const idColumn = type === 'files' ? 'file_id' : 'folder_id';

    try {
        const query = `
        UPDATE ${tableName}
        SET is_starred = ?
        WHERE ${idColumn} = ?
      `;

        // Use promise interface to execute query
        await db.promise().query(query, [is_starred ? 1 : 0, id]);

        res.status(200).json({ message: 'Star status updated successfully' });
    } catch (error) {
        console.error('Error updating star status:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/drive/starred', async (req, res) => {
    const { user_email } = req.query;

    if (!user_email) {
        return res.status(400).json({ error: 'Missing user_email in query' });
    }

    try {
        const [results] = await db.query(`
            SELECT 
                id,
                item_name AS name,
                type,
                file_type,
                size,
                created_at,
                starred_at
            FROM drive_files
            WHERE is_starred = 1
        `);

        res.json(results);
    } catch (error) {
        console.error('Error fetching starred items:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


module.exports = router;