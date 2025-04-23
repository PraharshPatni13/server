const express = require('express');
const mysql = require('mysql2');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Define root directory for file storage - same approach as in Drive_rout.js
const rootDirectory = path.join(__dirname, "..", "root");

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
});

// Simple helper to get user's root folder path
function getUserRootPath(userEmail) {
    return path.join(rootDirectory, userEmail, "drive");
}

// Get file for preview - simplified approach
router.get('/preview/:fileId', (req, res) => {
    try {
        const fileId = req.params.fileId;

        // Simple query to just get the file path and type
        const query = "SELECT file_path, file_name, file_type FROM drive_files WHERE file_id = ?";

        db.query(query, [fileId], (err, results) => {
            if (err) {
                console.error('Error fetching file:', err);
                return res.status(500).json({ message: 'Server error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = results[0];
            const filePath = file.file_path;

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: 'File not found on server' });
            }

            // Set appropriate content type based on file type
            const fileType = file.file_type.toLowerCase();
            let contentType = 'application/octet-stream'; // Default content type

            // Set content type based on file extension
            if (/jpg|jpeg/.test(fileType)) {
                contentType = 'image/jpeg';
            } else if (/png/.test(fileType)) {
                contentType = 'image/png';
            } else if (/gif/.test(fileType)) {
                contentType = 'image/gif';
            } else if (/svg/.test(fileType)) {
                contentType = 'image/svg+xml';
            } else if (/webp/.test(fileType)) {
                contentType = 'image/webp';
            } else if (/mp4/.test(fileType)) {
                contentType = 'video/mp4';
            } else if (/webm/.test(fileType)) {
                contentType = 'video/webm';
            } else if (/ogg/.test(fileType)) {
                contentType = fileType === 'ogg' ? 'audio/ogg' : 'video/ogg';
            } else if (/mov/.test(fileType)) {
                contentType = 'video/quicktime';
            } else if (/mp3/.test(fileType)) {
                contentType = 'audio/mpeg';
            } else if (/wav/.test(fileType)) {
                contentType = 'audio/wav';
            } else if (/pdf/.test(fileType)) {
                contentType = 'application/pdf';
            } else if (/txt/.test(fileType)) {
                contentType = 'text/plain';
            } else if (/html/.test(fileType)) {
                contentType = 'text/html';
            } else if (/css/.test(fileType)) {
                contentType = 'text/css';
            } else if (/js/.test(fileType)) {
                contentType = 'application/javascript';
            } else if (/json/.test(fileType)) {
                contentType = 'application/json';
            } else if (/doc|docx/.test(fileType)) {
                contentType = 'application/msword';
            } else if (/xls|xlsx/.test(fileType)) {
                contentType = 'application/vnd.ms-excel';
            } else if (/ppt|pptx/.test(fileType)) {
                contentType = 'application/vnd.ms-powerpoint';
            } else if (/zip/.test(fileType)) {
                contentType = 'application/zip';
            } else if (/rar/.test(fileType)) {
                contentType = 'application/x-rar-compressed';
            } else if (/7z/.test(fileType)) {
                contentType = 'application/x-7z-compressed';
            } else if (/tar/.test(fileType)) {
                contentType = 'application/x-tar';
            } else if (/gz/.test(fileType)) {
                contentType = 'application/gzip';
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${file.file_name}"`);

            // Stream the file directly
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);

            fileStream.on('error', (err) => {
                console.error('Error streaming file:', err);
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Error streaming file' });
                }
            });
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 