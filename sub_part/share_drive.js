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


//for fetching the shared drive by me
router.post('/share_drive_by_me', (req, res) => {
    const { user_email } = req.body;

    const folderSql = `SELECT * FROM drive_folders WHERE user_email = ? AND is_shared = 1`;
    const fileSql = `SELECT * FROM drive_files WHERE user_email = ? AND is_shared = 1`;

    db.query(folderSql, [user_email], (folderErr, folderResult) => {
        if (folderErr) return res.status(500).json({ error: folderErr });

        db.query(fileSql, [user_email], (fileErr, fileResult) => {
            if (fileErr) return res.status(500).json({ error: fileErr });

            res.json({
                shared_folders: folderResult,
                shared_files: fileResult
            });
        });
    });
});

//for fetching the shared drive with me

router.post('/share_drive_with_me', (req, res) => {
    const { user_email } = req.body;
    console.log("Requested shared items for user_email:", user_email);

    // Step 1: Fetch folder access
    const folderAccessSql = `
        SELECT folder_id, shared_by, permission FROM drive_file_access
        WHERE shared_with = ? AND folder_id IS NOT NULL`;

    db.query(folderAccessSql, [user_email], (folderAccessErr, folderAccessResult) => {
        if (folderAccessErr) {
            console.error('Folder Access Error:', folderAccessErr);
            return res.status(500).json({ error: "Database error while fetching folder access." });
        }

        const folderIds = folderAccessResult.map(record => record.folder_id);
        const folderSharedInfoMap = {};  // Store shared_by and permission both
        folderAccessResult.forEach(record => {
            folderSharedInfoMap[record.folder_id] = {
                shared_by: record.shared_by,
                permission: record.permission
            };
        });

        // Step 2: Fetch file access
        const fileAccessSql = `
            SELECT file_id, shared_by, permission FROM drive_file_access
            WHERE shared_with = ? AND file_id IS NOT NULL`;

        db.query(fileAccessSql, [user_email], (fileAccessErr, fileAccessResult) => {
            if (fileAccessErr) {
                console.error('File Access Error:', fileAccessErr);
                return res.status(500).json({ error: "Database error while fetching file access." });
            }

            const fileIds = fileAccessResult.map(record => record.file_id);
            const fileSharedInfoMap = {};  // Store shared_by and permission both
            fileAccessResult.forEach(record => {
                fileSharedInfoMap[record.file_id] = {
                    shared_by: record.shared_by,
                    permission: record.permission
                };
            });

            // Step 3: Collect unique shared_by emails (from both folder and file)
            const allSharedByEmails = new Set([
                ...Object.values(folderSharedInfoMap).map(info => info.shared_by),
                ...Object.values(fileSharedInfoMap).map(info => info.shared_by)
            ]);

            // Step 4: Fetch profile images for all shared_by users
            const fetchProfiles = new Promise((resolve, reject) => {
                if (allSharedByEmails.size === 0) return resolve({});
                const profileSql = `
                    SELECT user_email, user_profile_image_base64
                    FROM owner
                    WHERE user_email IN (?)`;
                db.query(profileSql, [[...allSharedByEmails]], (profileErr, profileResult) => {
                    if (profileErr) {
                        console.error('Profile Fetch Error:', profileErr);
                        return reject("Error fetching profile images.");
                    }
                    const profileMap = {};
                    profileResult.forEach(record => {
                        profileMap[record.user_email] = record.user_profile_image_base64;
                    });
                    resolve(profileMap);
                });
            });

            // Step 5: Fetch folder and file details
            const fetchFolders = new Promise((resolve, reject) => {
                if (folderIds.length === 0) return resolve([]);
                const folderDetailsSql = `
                    SELECT * FROM drive_folders 
                    WHERE folder_id IN (?)`;
                db.query(folderDetailsSql, [folderIds], (folderErr, folderResult) => {
                    if (folderErr) {
                        console.error('Folder Details Error:', folderErr);
                        return reject("Error fetching folder details.");
                    }
                    resolve(folderResult);
                });
            });

            const fetchFiles = new Promise((resolve, reject) => {
                if (fileIds.length === 0) return resolve([]);
                const fileDetailsSql = `
                    SELECT * FROM drive_files 
                    WHERE file_id IN (?)`;
                db.query(fileDetailsSql, [fileIds], (fileErr, fileResult) => {
                    if (fileErr) {
                        console.error('File Details Error:', fileErr);
                        return reject("Error fetching file details.");
                    }
                    resolve(fileResult);
                });
            });

            // Step 6: Wait for everything
            Promise.all([fetchProfiles, fetchFolders, fetchFiles])
                .then(([profileMap, sharedFoldersRaw, sharedFilesRaw]) => {

                    // ✅ Attach shared_by, shared_by_profile_image, permission to each folder
                    const sharedFolders = sharedFoldersRaw.map(folder => {
                        const info = folderSharedInfoMap[folder.folder_id] || {};
                        return {
                            ...folder,
                            shared_by: info.shared_by || null,
                            shared_by_profile_image: profileMap[info.shared_by] || null,
                            permission: info.permission || null
                        };
                    });

                    // ✅ Attach shared_by, shared_by_profile_image, permission to each file
                    const sharedFiles = sharedFilesRaw.map(file => {
                        const info = fileSharedInfoMap[file.file_id] || {};
                        return {
                            ...file,
                            shared_by: info.shared_by || null,
                            shared_by_profile_image: profileMap[info.shared_by] || null,
                            permission: info.permission || null
                        };
                    });

                    res.json({
                        shared_folders: sharedFolders,
                        shared_files: sharedFiles
                    });
                })
                .catch(error => {
                    console.error('Final Fetch Error:', error);
                    res.status(500).json({ error });
                });
        });
    });
});



//for sharing the drive
router.post('/share_with_permission', (req, res) => {
    const { item_id, item_type, shared_by, share_with } = req.body;

    if (!item_id || !item_type || !shared_by || !share_with || share_with.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const insertData = [];

    // Loop through each shared_with email and prepare data for insertion
    for (const owner of share_with) {
        const { email, permission } = owner;
        console.log("email", permission);

        if (!['read', 'write', 'admin'].includes(permission)) {
            return res.status(400).json({ error: `Invalid permission for ${email}` });
        }

        if (item_type === 'folder') {
            insertData.push([item_id, null, permission, false, shared_by, email]);
        } else if (item_type === 'file') {
            insertData.push([null, item_id, permission, false, shared_by, email]);
        } else {
            return res.status(400).json({ error: "Invalid item type" });
        }
    }

    if (insertData.length === 0) {
        return res.status(400).json({ error: "No valid data to insert" });
    }

    const sql = `
        INSERT INTO drive_file_access (folder_id, file_id, permission, shared_public, shared_by, shared_with) 
        VALUES ?`;

    db.query(sql, [insertData], (err, result) => {
        if (err) {
            console.error("Error inserting data into drive_file_access:", err);
            return res.status(500).json({ error: "Failed to share item" });
        }

        // ✅ After sharing, update is_shared = 1 for the folder or file
        let updateSql = "";
        if (item_type === 'folder') {
            updateSql = `UPDATE drive_folders SET is_shared = 1 WHERE folder_id = ?`;
        } else if (item_type === 'file') {
            updateSql = `UPDATE drive_files SET is_shared = 1 WHERE file_id = ?`;
        }

        db.query(updateSql, [item_id], (updateErr, updateResult) => {
            if (updateErr) {
                console.error("Error updating is_shared field:", updateErr);
                return res.status(500).json({ error: "Failed to update shared status" });
            }

            res.json({ message: "Items shared successfully and is_shared updated" });
        });
    });
});



module.exports = router;