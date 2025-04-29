const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
require('dotenv').config();
const {send_shared_item_email} = require('../modules/send_server_email');



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

    for (const owner of share_with) {
        const { email, permission } = owner;
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
            console.error("Error inserting data:", err);
            return res.status(500).json({ error: "Failed to share item" });
        }

        const updateSql = item_type === 'folder'
            ? `UPDATE drive_folders SET is_shared = 1 WHERE folder_id = ?`
            : `UPDATE drive_files SET is_shared = 1 WHERE file_id = ?`;

        db.query(updateSql, [item_id], async (updateErr) => {
            if (updateErr) {
                console.error("Error updating shared flag:", updateErr);
                return res.status(500).json({ error: "Failed to update shared status" });
            }

            try {
                // Get item name and shared_by user name
                const itemQuery = item_type === 'folder'
                    ? `SELECT folder_name AS name FROM drive_folders WHERE folder_id = ?`
                    : `SELECT file_name AS name FROM drive_files WHERE file_id = ?`;

                const userQuery = `SELECT user_name FROM owner WHERE user_email = ?`;
                console.log("item_id.............", item_id,shared_by);

                db.query(itemQuery, [item_id], (itemErr, itemResults) => {
                    if (itemErr || itemResults.length === 0) {
                        console.error("Failed to get item name", itemErr);
                        return res.status(500).json({ error: "Failed to get item name" });
                    }

                    const itemName = itemResults[0].name;

                    db.query(userQuery, [shared_by], async (userErr, userResults) => {
                        if (userErr || userResults.length === 0) {
                            console.error("Failed to get user name", userErr);
                            return res.status(500).json({ error: "Failed to get user info" });
                        }
                        console.log("userResults.............", userResults);

                        const sharedByName = userResults[0].user_name;
                        console.log("sharedByName.............", sharedByName);
                        
                        for (const owner of share_with) {
                            const { email, permission } = owner;
                            console.log("email.............", shared_by, sharedByName, email, item_type, itemName, permission);
                            await send_shared_item_email(shared_by, sharedByName, email, item_type, itemName, permission);
                        }

                        res.json({ message: "Items shared and emails sent successfully" });
                    });
                });
            } catch (emailErr) {
                console.error('Error sending emails:', emailErr);
                return res.status(500).json({ error: "Failed to send emails" });
            }
        });
    });
});

router.post('/fetch-avatars', async (req, res) => {
    const { file_ids = [], folder_ids = [] } = req.body;

    if (!Array.isArray(file_ids) || !Array.isArray(folder_ids)) {
        console.log("Invalid input format");
        return res.status(400).json({ error: 'Invalid input format' });
    }

    const totalItems = file_ids.length + folder_ids.length;
    if (totalItems <= 0) {
        console.log("No items provided to fetch avatars");
        return res.json({}); // Don't run DB queries
    }

    try {
        const allSharedWith = new Set();
        const sharedMap = {};

        // Process file_ids
        for (const item of file_ids) {
            const { id, shared_by } = item || {};
            if (!id || !shared_by) continue;

            const fileQuery = `SELECT shared_with FROM drive_file_access 
                             WHERE file_id = ? AND shared_by = ?`;
            
            db.query(fileQuery, [id, shared_by], (err, rows) => {
                if (err) {
                    console.error('Error fetching file access:', err);
                    return;
                }

                const emails = Array.isArray(rows)
                    ? rows.map(row => row.shared_with).filter(Boolean)
                    : [];

                sharedMap[id] = emails;
                emails.forEach(email => allSharedWith.add(email));
            });
        }

        // Process folder_ids
        for (const item of folder_ids) {
            const { id, shared_by } = item || {};
            if (!id || !shared_by) continue;

            const folderQuery = `SELECT shared_with FROM drive_file_access 
                               WHERE folder_id = ? AND shared_by = ?`;
            
            db.query(folderQuery, [id, shared_by], (err, rows) => {
                if (err) {
                    console.error('Error fetching folder access:', err);
                    return;
                }

                const emails = Array.isArray(rows)
                    ? rows.map(row => row.shared_with).filter(Boolean)
                    : [];

                sharedMap[id] = emails;
                emails.forEach(email => allSharedWith.add(email));
            });
        }

        const sharedEmails = Array.from(allSharedWith);
        if (sharedEmails.length === 0) {
            console.log("No shared users found");
            return res.json({});
        }

        const profileQuery = `SELECT user_email, user_name, user_profile_image_base64 
                            FROM owner WHERE user_email IN (?)`;
        
        db.query(profileQuery, [sharedEmails], (err, profiles) => {
            if (err) {
                console.error('Error fetching profiles:', err);
                return res.status(500).json({ error: 'Error fetching user profiles' });
            }

            const profileMap = {};
            for (const user of profiles || []) {
                profileMap[user.user_email] = {
                    name: user.user_name,
                    email: user.user_email,
                    profile_image: user.user_profile_image_base64
                };
            }

            const result = {};
            for (const [id, emails] of Object.entries(sharedMap || {})) {
                result[id] = Array.isArray(emails)
                    ? emails.map(email => profileMap[email]).filter(Boolean)
                    : [];
            }

            res.json(result);
        });

    } catch (err) {
        console.error('Error fetching shared avatars:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



module.exports = router;