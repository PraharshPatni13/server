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

router.get('/drive/get_starred_items', async (req, res) => {
    const user_email = req.query.user_email;
    console.log("for get starred items message", user_email);

    if (!user_email) {
        return res.status(400).json({ error: 'User email is required' });
    }

    try {
        // Query for starred folders
        const [starredFolders] = await db.promise().query(
            `SELECT * FROM drive_folders WHERE user_email = ? AND is_starred = 1`,
            [user_email]
        );

        // Query for starred files
        const [starredFiles] = await db.promise().query(
            `SELECT * FROM drive_files WHERE user_email = ? AND is_starred = 1`,
            [user_email]
        );

        // Send response with both starred folders and files
        res.status(200).json({
            starred_folders: starredFolders,
            starred_files: starredFiles
        });
    } catch (error) {
        console.error('Error fetching starred items:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


module.exports = router;