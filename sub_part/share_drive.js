const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
require('dotenv').config();
const { send_shared_item_email } = require('../modules/send_server_email');
const bcrypt = require('bcrypt');



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
                console.log("item_id.............", item_id, shared_by);

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

// New endpoint to share with external users
router.post('/share_with_external', async (req, res) => {
    const { item_id, item_type, shared_by, external_users, send_notification } = req.body;

    if (!item_id || !item_type || !shared_by || !external_users || external_users.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        // First, create external user accounts if they don't exist
        for (const extUser of external_users) {
            const { username, email, password, permission } = extUser;
            
            if (!username || !email || !password) {
                return res.status(400).json({ error: `Missing data for external user ${email}` });
            }
            
            if (!['read', 'write', 'admin'].includes(permission)) {
                return res.status(400).json({ error: `Invalid permission for ${email}` });
            }

            // Check if external user already exists
            const checkUserSql = `SELECT * FROM external_users WHERE email = ?`;
            
            const [existingUsers] = await db.promise().query(checkUserSql, [email]);
            
            if (existingUsers.length === 0) {
                // Hash password
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                
                // Insert new external user
                const insertUserSql = `
                    INSERT INTO external_users (username, email, password, created_by) 
                    VALUES (?, ?, ?, ?)`;
                
                await db.promise().query(insertUserSql, [username, email, hashedPassword, shared_by]);
                
                if (send_notification) {
                    // Send welcome email with credentials
                    try {
                        // TODO: Implement external user welcome email
                        // await send_external_user_welcome_email(email, username, password, shared_by);
                    } catch (emailErr) {
                        console.error('Error sending welcome email:', emailErr);
                        // Continue even if email fails
                    }
                }
            }
            
            // Grant access to the item
            const insertAccessSql = `
                INSERT INTO drive_file_access 
                (folder_id, file_id, permission, shared_public, shared_by, shared_with, is_external) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            
            const accessValues = item_type === 'folder' 
                ? [item_id, null, permission, false, shared_by, email, true]
                : [null, item_id, permission, false, shared_by, email, true];
            
            await db.promise().query(insertAccessSql, accessValues);
        }
        
        // Update the shared status of the item
        const updateSql = item_type === 'folder'
            ? `UPDATE drive_folders SET is_shared = 1 WHERE folder_id = ?`
            : `UPDATE drive_files SET is_shared = 1 WHERE file_id = ?`;
        
        await db.promise().query(updateSql, [item_id]);
        
        // Get item details for notification
        if (send_notification) {
            const itemQuery = item_type === 'folder'
                ? `SELECT folder_name AS name FROM drive_folders WHERE folder_id = ?`
                : `SELECT file_name AS name FROM drive_files WHERE file_id = ?`;
                
            const userQuery = `SELECT user_name FROM owner WHERE user_email = ?`;
            
            const [itemResults] = await db.promise().query(itemQuery, [item_id]);
            if (itemResults.length === 0) {
                throw new Error("Failed to get item details");
            }
            
            const itemName = itemResults[0].name;
            
            const [userResults] = await db.promise().query(userQuery, [shared_by]);
            if (userResults.length === 0) {
                throw new Error("Failed to get user details");
            }
            
            const sharedByName = userResults[0].user_name;
            
            // Send notifications
            for (const extUser of external_users) {
                const { email, permission } = extUser;
                if (send_notification) {
                    await send_shared_item_email(
                        shared_by, 
                        sharedByName, 
                        email, 
                        item_type, 
                        itemName, 
                        permission
                    );
                }
            }
        }
        
        res.status(200).json({ 
            message: "Item shared with external users successfully" 
        });
        
    } catch (error) {
        console.error("Error sharing with external users:", error);
        res.status(500).json({ error: error.message || "Failed to share with external users" });
    }
});

// Helper function to generate a public access link
function generatePublicLink(itemId, itemType) {
    // Generate a unique token
    const accessToken = Buffer.from(`${itemType}-${itemId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`).toString('base64');
    return accessToken;
}

router.post('/share_with_anyone', async (req, res) => {
    const { item_id, item_type, shared_by, permission = 'read' } = req.body;

    if (!item_id || !item_type || !shared_by) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const isFolder = item_type === 'folder';
    const table = isFolder ? 'drive_folders' : 'drive_files';
    const idColumn = isFolder ? 'folder_id' : 'file_id';

    db.beginTransaction(async (err) => {
        if (err) return res.status(500).json({ error: "Transaction start failed" });

        try {
            // 1. Check if item is already public
            const [publicCheck] = await db.promise().query(
                `SELECT shared_public FROM ${table} WHERE ${idColumn} = ?`,
                [item_id]
            );

            const isAlreadyPublic = publicCheck.length > 0 && publicCheck[0].shared_public === 1;
            let accessToken;
            let isPermissionUpdated = false;

            if (isAlreadyPublic) {
                // Check for existing public link
                const [accessLinks] = await db.promise().query(
                    `SELECT access_token FROM public_access_links WHERE ${idColumn} = ? AND is_active = 1`,
                    [item_id]
                );

                if (accessLinks.length > 0) {
                    accessToken = accessLinks[0].access_token;

                    const [permCheck] = await db.promise().query(
                        `SELECT permission FROM drive_file_access WHERE ${idColumn} = ? AND shared_public = 1`,
                        [item_id]
                    );

                    if (permCheck.length > 0 && permCheck[0].permission !== permission) {
                        await db.promise().query(
                            `UPDATE drive_file_access SET permission = ? WHERE ${idColumn} = ? AND shared_public = 1`,
                            [permission, item_id]
                        );
                        isPermissionUpdated = true;
                    }
                } else {
                    // No link found, create one
                    accessToken = generatePublicLink(item_id, item_type);

                    await db.promise().query(
                        `INSERT INTO public_access_links (access_token, ${idColumn}, created_by) VALUES (?, ?, ?)`,
                        [accessToken, item_id, shared_by]
                    );

                    await db.promise().query(
                        `REPLACE INTO drive_file_access (folder_id, file_id, permission, shared_public, shared_by)
                         VALUES (?, ?, ?, 1, ?)`,
                        isFolder ? [item_id, null, permission, shared_by] : [null, item_id, permission, shared_by]
                    );

                    isPermissionUpdated = true;
                }
            } else {
                // Make item public
                await db.promise().query(
                    `UPDATE ${table} SET is_shared = 1, shared_public = 1 WHERE ${idColumn} = ?`,
                    [item_id]
                );

                await db.promise().query(
                    `INSERT INTO drive_file_access (folder_id, file_id, permission, shared_public, shared_by)
                     VALUES (?, ?, ?, 1, ?)`,
                    isFolder ? [item_id, null, permission, shared_by] : [null, item_id, permission, shared_by]
                );

                accessToken = generatePublicLink(item_id, item_type);

                await db.promise().query(
                    `INSERT INTO public_access_links (access_token, ${idColumn}, created_by) VALUES (?, ?, ?)`,
                    [accessToken, item_id, shared_by]
                );
            }

            db.commit((err) => {
                if (err) {
                    db.rollback(() => {});
                    return res.status(500).json({ error: "Transaction commit failed" });
                }

                res.status(200).json({
                    message: isAlreadyPublic ? "Public link permissions updated" : "Item shared publicly",
                    public_link: `${process.env.APP_URL}/share/${accessToken}`,
                    access_token: accessToken,
                    is_update: isAlreadyPublic,
                    permission_changed: isPermissionUpdated
                });
            });

        } catch (error) {
            db.rollback(() => {});
            console.error("Share error:", error);
            res.status(500).json({ error: "Failed to share item publicly" });
        }
    });
});

// Endpoint to validate public access token
router.get('/public-access/:accessToken', async (req, res) => {
    const { accessToken } = req.params;
    
    if (!accessToken) {
        return res.status(400).json({ error: "Invalid access token" });
    }
    
    try {
        // Look up the access token in the database
        const [accessLinks] = await db.promise().query(
            `SELECT * FROM public_access_links 
             WHERE access_token = ? AND is_active = 1`,
            [accessToken]
        );
        
        if (accessLinks.length === 0) {
            return res.status(404).json({ error: "Access link not found or expired" });
        }
        
        const accessLink = accessLinks[0];
        const isFolder = !!accessLink.folder_id;
        
        let item;
        let owner;
        
        if (isFolder) {
            // Get folder details
            const [folders] = await db.promise().query(
                `SELECT f.*, o.user_name as owner_name, dfa.permission
                 FROM drive_folders f
                 JOIN owner o ON f.user_email = o.user_email
                 LEFT JOIN drive_file_access dfa ON dfa.folder_id = f.folder_id AND dfa.shared_public = 1
                 WHERE f.folder_id = ?`,
                [accessLink.folder_id]
            );
            
            if (folders.length === 0) {
                return res.status(404).json({ error: "Folder not found" });
            }
            
            const folder = folders[0];
            
            // Get folder contents (files and subfolders)
            const [files] = await db.promise().query(
                `SELECT file_id, file_name, file_type, file_size, created_date, modified_date
                 FROM drive_files 
                 WHERE parent_folder_id = ?`,
                [accessLink.folder_id]
            );
            
            const [subfolders] = await db.promise().query(
                `SELECT folder_id, folder_name, created_date, modified_date
                 FROM drive_folders 
                 WHERE parent_id = ?`,
                [accessLink.folder_id]
            );
            
            // Format folder contents
            const contents = [
                ...subfolders.map(sf => ({
                    id: sf.folder_id,
                    name: sf.folder_name,
                    type: 'folder',
                    created_date: sf.created_date,
                    modified_date: sf.modified_date
                })),
                ...files.map(f => ({
                    id: f.file_id,
                    name: f.file_name,
                    type: 'file',
                    file_type: f.file_type,
                    size: f.file_size,
                    created_date: f.created_date,
                    modified_date: f.modified_date
                }))
            ];
            
            item = {
                id: folder.folder_id,
                name: folder.folder_name,
                type: 'folder',
                created_date: folder.created_date,
                modified_date: folder.modified_date,
                itemCount: contents.length,
                contents,
                permission: folder.permission || 'read'
            };
            
            owner = {
                email: folder.user_email,
                name: folder.owner_name
            };
            
        } else {
            // Get file details
            const [files] = await db.promise().query(
                `SELECT f.*, o.user_name as owner_name, dfa.permission
                 FROM drive_files f
                 JOIN owner o ON f.user_email = o.user_email
                 LEFT JOIN drive_file_access dfa ON dfa.file_id = f.file_id AND dfa.shared_public = 1
                 WHERE f.file_id = ?`,
                [accessLink.file_id]
            );
            
            if (files.length === 0) {
                return res.status(404).json({ error: "File not found" });
            }
            
            const file = files[0];
            
            item = {
                id: file.file_id,
                name: file.file_name,
                type: 'file',
                file_type: file.file_type,
                size: file.file_size,
                created_date: file.created_date,
                modified_date: file.modified_date,
                permission: file.permission || 'read'
            };
            
            owner = {
                email: file.user_email,
                name: file.owner_name
            };
        }
        
        res.status(200).json({ 
            item, 
            owner,
            access_token: accessToken 
        });
        
    } catch (error) {
        console.error("Error retrieving public access item:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Endpoint to update public link access
router.put('/update-public-access', async (req, res) => {
    const { access_token, permission, is_active } = req.body;
    
    if (!access_token) {
        return res.status(400).json({ error: "Access token is required" });
    }
    
    try {
        // Find the public access link record
        const [links] = await db.promise().query(
            `SELECT * FROM public_access_links WHERE access_token = ?`,
            [access_token]
        );
        
        if (links.length === 0) {
            return res.status(404).json({ error: "Access link not found" });
        }
        
        const link = links[0];
        const itemId = link.folder_id || link.file_id;
        const itemType = link.folder_id ? 'folder' : 'file';
        
        // Begin transaction
        const connection = await db.promise().getConnection();
        await connection.beginTransaction();
        
        try {
            // Update permission if provided
            if (permission) {
                const updatePermissionSql = `
                    UPDATE drive_file_access
                    SET permission = ?
                    WHERE ${itemType === 'folder' ? 'folder_id' : 'file_id'} = ?
                    AND shared_public = 1`;
                
                await connection.query(updatePermissionSql, [permission, itemId]);
            }
            
            // Update active status if provided
            if (is_active !== undefined) {
                // Update public_access_links table
                const updateLinkSql = `
                    UPDATE public_access_links
                    SET is_active = ?
                    WHERE access_token = ?`;
                
                await connection.query(updateLinkSql, [is_active ? 1 : 0, access_token]);
                
                // If deactivating, also update the item's shared_public flag
                if (!is_active) {
                    const updateItemSql = `
                        UPDATE ${itemType === 'folder' ? 'drive_folders' : 'drive_files'}
                        SET shared_public = 0
                        WHERE ${itemType === 'folder' ? 'folder_id' : 'file_id'} = ?`;
                    
                    await connection.query(updateItemSql, [itemId]);
                    
                    // Delete the drive_file_access record for public sharing
                    const deleteAccessSql = `
                        DELETE FROM drive_file_access
                        WHERE ${itemType === 'folder' ? 'folder_id' : 'file_id'} = ?
                        AND shared_public = 1`;
                    
                    await connection.query(deleteAccessSql, [itemId]);
                }
            }
            
            // Commit transaction
            await connection.commit();
            
            res.status(200).json({ 
                message: "Public access updated successfully",
                updated: {
                    permission: permission || undefined,
                    is_active: is_active !== undefined ? is_active : undefined
                }
            });
            
        } catch (error) {
            // Rollback transaction in case of error
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error("Error updating public access:", error);
        res.status(500).json({ error: "Failed to update public access" });
    }
});

// Endpoint to get item details by public access token
router.get('/public-access/:accessToken', async (req, res) => {
    const { accessToken } = req.params;
    
    if (!accessToken) {
        return res.status(400).json({ error: "Invalid access token" });
    }
    
    try {
        // Look up the access token in the database
        const [accessLinks] = await db.promise().query(
            `SELECT * FROM public_access_links 
             WHERE access_token = ? AND is_active = 1`,
            [accessToken]
        );
        
        if (accessLinks.length === 0) {
            return res.status(404).json({ error: "Access link not found or expired" });
        }
        
        const accessLink = accessLinks[0];
        const isFolder = !!accessLink.folder_id;
        
        let item;
        let owner;
        
        if (isFolder) {
            // Get folder details
            const [folders] = await db.promise().query(
                `SELECT f.*, o.user_name as owner_name 
                 FROM drive_folders f
                 JOIN owner o ON f.user_email = o.user_email
                 WHERE f.folder_id = ?`,
                [accessLink.folder_id]
            );
            
            if (folders.length === 0) {
                return res.status(404).json({ error: "Folder not found" });
            }
            
            const folder = folders[0];
            
            // Get folder contents (files and subfolders)
            const [files] = await db.promise().query(
                `SELECT file_id, file_name, file_type, file_size, created_date, modified_date
                 FROM drive_files 
                 WHERE parent_folder_id = ?`,
                [accessLink.folder_id]
            );
            
            const [subfolders] = await db.promise().query(
                `SELECT folder_id, folder_name, created_date, modified_date
                 FROM drive_folders 
                 WHERE parent_id = ?`,
                [accessLink.folder_id]
            );
            
            // Format folder contents
            const contents = [
                ...subfolders.map(sf => ({
                    id: sf.folder_id,
                    name: sf.folder_name,
                    type: 'folder',
                    created_date: sf.created_date,
                    modified_date: sf.modified_date
                })),
                ...files.map(f => ({
                    id: f.file_id,
                    name: f.file_name,
                    type: 'file',
                    file_type: f.file_type,
                    size: f.file_size,
                    created_date: f.created_date,
                    modified_date: f.modified_date
                }))
            ];
            
            item = {
                id: folder.folder_id,
                name: folder.folder_name,
                type: 'folder',
                created_date: folder.created_date,
                modified_date: folder.modified_date,
                itemCount: contents.length,
                contents
            };
            
            owner = {
                email: folder.user_email,
                name: folder.owner_name
            };
            
        } else {
            // Get file details
            const [files] = await db.promise().query(
                `SELECT f.*, o.user_name as owner_name 
                 FROM drive_files f
                 JOIN owner o ON f.user_email = o.user_email
                 WHERE f.file_id = ?`,
                [accessLink.file_id]
            );
            
            if (files.length === 0) {
                return res.status(404).json({ error: "File not found" });
            }
            
            const file = files[0];
            
            item = {
                id: file.file_id,
                name: file.file_name,
                type: 'file',
                file_type: file.file_type,
                size: file.file_size,
                created_date: file.created_date,
                modified_date: file.modified_date
            };
            
            owner = {
                email: file.user_email,
                name: file.owner_name
            };
        }
        
        res.status(200).json({ item, owner });
        
    } catch (error) {
        console.error("Error retrieving public access item:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// New endpoint to get current shares for an item (file or folder)
router.post('/get-current-shares', async (req, res) => {
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        // Query to get all users who already have access to this item
        const querySql = `
            SELECT dfa.shared_with, dfa.permission, dfa.is_external,
                   CASE 
                     WHEN dfa.is_external = 1 THEN eu.username
                     ELSE o.user_name 
                   END AS user_name,
                   CASE 
                     WHEN dfa.is_external = 1 THEN NULL
                     ELSE o.user_profile_image_base64 
                   END AS profile_image
            FROM drive_file_access dfa
            LEFT JOIN owner o ON dfa.shared_with = o.user_email AND dfa.is_external = 0
            LEFT JOIN external_users eu ON dfa.shared_with = eu.email AND dfa.is_external = 1
            WHERE ${item_type === 'folder' ? 'dfa.folder_id = ?' : 'dfa.file_id = ?'}
              AND dfa.shared_with IS NOT NULL`;
        
        const [shares] = await db.promise().query(querySql, [item_id]);
        
        // Format the response
        const currentShares = shares.map(share => ({
            email: share.shared_with,
            name: share.user_name,
            permission: share.permission,
            is_external: !!share.is_external,
            profile_image: share.profile_image
        }));
        
        // Check if item is shared publicly
        const publicSql = `
            SELECT shared_public FROM ${item_type === 'folder' ? 'drive_folders' : 'drive_files'}
            WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?`;
        
        const [publicResult] = await db.promise().query(publicSql, [item_id]);
        const isPublic = publicResult.length > 0 && publicResult[0].shared_public === 1;
        
        res.json({
            current_shares: currentShares,
            is_public: isPublic
        });
        
    } catch (error) {
        console.error("Error fetching current shares:", error);
        res.status(500).json({ error: error.message || "Failed to fetch current shares" });
    }
});

// New endpoint to revoke access for a shared item
router.post('/revoke-access', (req, res) => {
    const { item_id, item_type, email, is_external } = req.body;

    if (!item_id || !item_type || !email) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Begin transaction
    db.beginTransaction(err => {
        if (err) {
            console.error("Transaction start failed:", err);
            return res.status(500).json({ error: "Failed to start transaction" });
        }

        try {
            // Delete the access record
            const deleteSql = `
                DELETE FROM drive_file_access
                WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                AND shared_with = ?
                ${is_external ? 'AND is_external = 1' : 'AND (is_external = 0 OR is_external IS NULL)'}
            `;
            
            db.query(deleteSql, [item_id, email], (err, result) => {
                if (err) {
                    return db.rollback(() => {
                        console.error("Error deleting access:", err);
                        res.status(500).json({ error: "Failed to delete access" });
                    });
                }
                
                if (result.affectedRows === 0) {
                    return db.rollback(() => {
                        res.status(404).json({ error: "No matching share record found" });
                    });
                }
                
                // Check if there are any remaining shares for this item
                const countSql = `
                    SELECT COUNT(*) as share_count 
                    FROM drive_file_access
                    WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                `;
                
                db.query(countSql, [item_id], (err, countResult) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error("Error counting shares:", err);
                            res.status(500).json({ error: "Failed to count shares" });
                        });
                    }
                    
                    const shareCount = countResult[0].share_count;
                    
                    // If no more shares exist, update the is_shared flag to 0
                    if (shareCount === 0) {
                        const updateSql = `
                            UPDATE ${item_type === 'folder' ? 'drive_folders' : 'drive_files'}
                            SET is_shared = 0, shared_public = 0
                            WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                        `;
                        
                        db.query(updateSql, [item_id], (err, result) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error updating shared status:", err);
                                    res.status(500).json({ error: "Failed to update shared status" });
                                });
                            }
                            
                            // Commit transaction
                            db.commit(err => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.error("Error committing transaction:", err);
                                        res.status(500).json({ error: "Failed to commit transaction" });
                                    });
                                }
                                
                                res.status(200).json({ 
                                    message: "Access revoked successfully",
                                    remaining_shares: shareCount
                                });
                            });
                        });
                    } else {
                        // Commit transaction without updating is_shared flag
                        db.commit(err => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error committing transaction:", err);
                                    res.status(500).json({ error: "Failed to commit transaction" });
                                });
                            }
                            
                            res.status(200).json({ 
                                message: "Access revoked successfully",
                                remaining_shares: shareCount
                            });
                        });
                    }
                });
            });
        } catch (error) {
            db.rollback(() => {
                console.error("Error revoking access:", error);
                res.status(500).json({ error: "Failed to revoke access" });
            });
        }
    });
});

// Endpoint to revoke public sharing
router.post('/revoke-public-access', (req, res) => {
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Begin transaction
    db.beginTransaction(err => {
        if (err) {
            console.error("Transaction start failed:", err);
            return res.status(500).json({ error: "Failed to start transaction" });
        }

        try {
            // Update the item to remove public sharing
            const updateItemSql = `
                UPDATE ${item_type === 'folder' ? 'drive_folders' : 'drive_files'}
                SET shared_public = 0
                WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
            `;
            
            db.query(updateItemSql, [item_id], (err, result) => {
                if (err) {
                    return db.rollback(() => {
                        console.error("Error updating item:", err);
                        res.status(500).json({ error: "Failed to update item" });
                    });
                }
                
                // Deactivate all public access links for this item
                const updateLinksSql = `
                    UPDATE public_access_links
                    SET is_active = 0
                    WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                `;
                
                db.query(updateLinksSql, [item_id], (err, result) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error("Error updating links:", err);
                            res.status(500).json({ error: "Failed to update links" });
                        });
                    }
                    
                    // Delete the public access record
                    const deleteAccessSql = `
                        DELETE FROM drive_file_access
                        WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                        AND shared_public = 1
                    `;
                    
                    db.query(deleteAccessSql, [item_id], (err, result) => {
                        if (err) {
                            return db.rollback(() => {
                                console.error("Error deleting access:", err);
                                res.status(500).json({ error: "Failed to delete access" });
                            });
                        }
                        
                        // Check if there are any remaining shares for this item
                        const countSql = `
                            SELECT COUNT(*) as share_count 
                            FROM drive_file_access
                            WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                        `;
                        
                        db.query(countSql, [item_id], (err, countResult) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error counting shares:", err);
                                    res.status(500).json({ error: "Failed to count shares" });
                                });
                            }
                            
                            const shareCount = countResult[0].share_count;
                            
                            // If no more shares exist, update the is_shared flag to 0
                            if (shareCount === 0) {
                                const updateSql = `
                                    UPDATE ${item_type === 'folder' ? 'drive_folders' : 'drive_files'}
                                    SET is_shared = 0
                                    WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                                `;
                                
                                db.query(updateSql, [item_id], (err, result) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.error("Error updating shared status:", err);
                                            res.status(500).json({ error: "Failed to update shared status" });
                                        });
                                    }
                                    
                                    // Commit transaction
                                    db.commit(err => {
                                        if (err) {
                                            return db.rollback(() => {
                                                console.error("Error committing transaction:", err);
                                                res.status(500).json({ error: "Failed to commit transaction" });
                                            });
                                        }
                                        
                                        res.status(200).json({ 
                                            message: "Public access revoked successfully",
                                            remaining_shares: shareCount
                                        });
                                    });
                                });
                            } else {
                                // Commit transaction without updating is_shared flag
                                db.commit(err => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.error("Error committing transaction:", err);
                                            res.status(500).json({ error: "Failed to commit transaction" });
                                        });
                                    }
                                    
                                    res.status(200).json({ 
                                        message: "Public access revoked successfully",
                                        remaining_shares: shareCount
                                    });
                                });
                            }
                        });
                    });
                });
            });
        } catch (error) {
            db.rollback(() => {
                console.error("Error revoking public access:", error);
                res.status(500).json({ error: "Failed to revoke public access" });
            });
        }
    });
});

// Endpoint to get public link for an item
router.post('/get-public-link', (req, res) => {
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // First check if the item is publicly shared
    const publicCheckSql = `
        SELECT shared_public FROM ${item_type === 'folder' ? 'drive_folders' : 'drive_files'}
        WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
    `;

    db.query(publicCheckSql, [item_id], (err, publicResult) => {
        if (err) {
            console.error("Error checking public status:", err);
            return res.status(500).json({ error: "Error checking public status" });
        }

        const isPublic = publicResult.length > 0 && publicResult[0].shared_public === 1;

        if (!isPublic) {
            return res.status(404).json({ error: "Item is not publicly shared" });
        }

        // Look up the access token in the public_access_links table
        const linkSql = `
            SELECT * FROM public_access_links 
            WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ? 
            AND is_active = 1
            ORDER BY created_date DESC
            LIMIT 1
        `;

        db.query(linkSql, [item_id], (err, linkResult) => {
            if (err) {
                console.error("Error fetching public link:", err);
                return res.status(500).json({ error: "Error fetching public link" });
            }

            if (linkResult.length === 0) {
                // No existing link, create one
                const accessToken = generatePublicLink(item_id, item_type);
                
                const insertLinkSql = `
                    INSERT INTO public_access_links (access_token, ${item_type === 'folder' ? 'folder_id' : 'file_id'}, created_by) 
                    VALUES (?, ?, ?)
                `;
                
                db.query(insertLinkSql, [accessToken, item_id, req.body.shared_by || 'system'], (err, insertResult) => {
                    if (err) {
                        console.error("Error creating public link:", err);
                        return res.status(500).json({ error: "Error creating public link" });
                    }
                    
                    // Check for permission
                    const permissionSql = `
                        SELECT permission FROM drive_file_access
                        WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                        AND shared_public = 1
                    `;
                    
                    db.query(permissionSql, [item_id], (err, permissionResult) => {
                        if (err) {
                            console.error("Error fetching permission:", err);
                            return res.status(500).json({ error: "Error fetching permission" });
                        }
                        
                        const permission = permissionResult.length > 0 
                            ? permissionResult[0].permission 
                            : 'read'; // Default to read if no permission found
                        
                        res.status(200).json({
                            access_token: accessToken,
                            public_link: `${process.env.APP_URL}/share/${accessToken}`,
                            permission: permission,
                            is_new: true
                        });
                    });
                });
            } else {
                // Return existing link
                const accessToken = linkResult[0].access_token;
                
                // Check for permission
                const permissionSql = `
                    SELECT permission FROM drive_file_access
                    WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                    AND shared_public = 1
                `;
                
                db.query(permissionSql, [item_id], (err, permissionResult) => {
                    if (err) {
                        console.error("Error fetching permission:", err);
                        return res.status(500).json({ error: "Error fetching permission" });
                    }
                    
                    const permission = permissionResult.length > 0 
                        ? permissionResult[0].permission 
                        : 'read'; // Default to read if no permission found
                    
                    res.status(200).json({
                        access_token: accessToken,
                        public_link: `${process.env.APP_URL}/share/${accessToken}`,
                        permission: permission,
                        is_new: false,
                        created_date: linkResult[0].created_date
                    });
                });
            }
        });
    });
});

// New endpoint to revoke all restricted users at once
router.post('/revoke-all-restricted-access', (req, res) => {
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Begin transaction
    db.beginTransaction(err => {
        if (err) {
            console.error("Transaction start failed:", err);
            return res.status(500).json({ error: "Failed to start transaction" });
        }

        try {
            // Delete all restricted access records (keep public access if exists)
            const deleteSql = `
                DELETE FROM drive_file_access
                WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                AND shared_public = 0
            `;
            
            db.query(deleteSql, [item_id], (err, result) => {
                if (err) {
                    return db.rollback(() => {
                        console.error("Error deleting access:", err);
                        res.status(500).json({ error: "Failed to delete access" });
                    });
                }
                
                if (result.affectedRows === 0) {
                    return db.rollback(() => {
                        res.status(404).json({ error: "No restricted shares found" });
                    });
                }
                
                // Check if there are any remaining shares for this item (public sharing)
                const countSql = `
                    SELECT COUNT(*) as share_count 
                    FROM drive_file_access
                    WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                `;
                
                db.query(countSql, [item_id], (err, countResult) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error("Error counting shares:", err);
                            res.status(500).json({ error: "Failed to count shares" });
                        });
                    }
                    
                    const shareCount = countResult[0].share_count;
                    
                    // If no more shares exist, update the is_shared flag to 0
                    if (shareCount === 0) {
                        const updateSql = `
                            UPDATE ${item_type === 'folder' ? 'drive_folders' : 'drive_files'}
                            SET is_shared = 0, shared_public = 0
                            WHERE ${item_type === 'folder' ? 'folder_id' : 'file_id'} = ?
                        `;
                        
                        db.query(updateSql, [item_id], (err, result) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error updating shared status:", err);
                                    res.status(500).json({ error: "Failed to update shared status" });
                                });
                            }
                            
                            // Commit transaction
                            db.commit(err => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.error("Error committing transaction:", err);
                                        res.status(500).json({ error: "Failed to commit transaction" });
                                    });
                                }
                                
                                res.status(200).json({ 
                                    message: "All restricted access revoked successfully",
                                    affected_rows: result.affectedRows,
                                    remaining_shares: shareCount
                                });
                            });
                        });
                    } else {
                        // Commit transaction without updating is_shared flag (public sharing remains)
                        db.commit(err => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error("Error committing transaction:", err);
                                    res.status(500).json({ error: "Failed to commit transaction" });
                                });
                            }
                            
                            res.status(200).json({ 
                                message: "All restricted access revoked successfully",
                                affected_rows: result.affectedRows,
                                remaining_shares: shareCount
                            });
                        });
                    }
                });
            });
        } catch (error) {
            db.rollback(() => {
                console.error("Error revoking all restricted access:", error);
                res.status(500).json({ error: "Failed to revoke all restricted access" });
            });
        }
    });
});

// Endpoint to validate external user credentials
router.post('/validate-external-user', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    
    try {
        // Find the external user in the database
        const [users] = await db.promise().query(
            "SELECT * FROM external_users WHERE email = ?",
            [email]
        );
        
        if (users.length === 0) {
            return res.status(401).json({ error: "Invalid email or password" });
        }
        
        const user = users[0];
        
        // Check if account is active
        if (!user.is_active) {
            return res.status(403).json({ error: "Your account is inactive. Please contact your administrator." });
        }
        
        // Compare passwords
        const match = await bcrypt.compare(password, user.password);
        
        if (!match) {
            // Log failed login attempt
            await db.promise().query(
                "INSERT INTO external_user_login_attempts (user_id, email, status, ip_address) VALUES (?, ?, ?, ?)",
                [user.id, email, 'failed', req.ip || 'unknown']
            ).catch(err => console.error("Error logging failed login:", err));
            
            return res.status(401).json({ error: "Invalid email or password" });
        }
        
        // Return the user info (excluding password)
        const userData = {
            id: user.id,
            username: user.username,
            email: user.email,
            created_at: user.created_at,
            created_by: user.created_by
        };
        
        // Update last login time
        await db.promise().query(
            "UPDATE external_users SET last_login = NOW() WHERE id = ?",
            [user.id]
        );
        
        // Log successful login
        try {
            await db.promise().query(
                "INSERT INTO external_user_login_attempts (user_id, email, status, ip_address) VALUES (?, ?, ?, ?)",
                [user.id, email, 'success', req.ip || 'unknown']
            );
        } catch (logErr) {
            console.error("Error logging successful login:", logErr);
            // Continue even if logging fails
        }
        
        res.status(200).json({
            message: "Login successful",
            user: userData
        });
        
    } catch (error) {
        console.error("External user login error:", error);
        res.status(500).json({ error: "Server error during authentication" });
    }
});

// Endpoint to get shared items for an external user
router.get('/external-user-items/:email', async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }
    
    try {
        // Verify this is a valid external user
        const [users] = await db.promise().query(
            "SELECT id, username, is_active FROM external_users WHERE email = ?",
            [email]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: "External user not found" });
        }
        
        // Check if user is active
        if (!users[0].is_active) {
            return res.status(403).json({ error: "Account is inactive. Please contact your administrator." });
        }
        
        // Get folders shared with this external user
        const [sharedFolders] = await db.promise().query(`
            SELECT 
                f.folder_id,
                f.folder_name,
                f.created_date,
                f.modified_date,
                dfa.permission,
                o.user_name AS owner_name,
                o.user_email AS owner_email,
                dfa.id AS access_id,
                f.is_shared,
                f.is_starred
            FROM 
                drive_file_access dfa
            JOIN 
                drive_folders f ON dfa.folder_id = f.folder_id
            JOIN 
                owner o ON f.user_email = o.user_email
            WHERE 
                dfa.shared_with = ? 
                AND dfa.is_external = 1
                AND dfa.folder_id IS NOT NULL
            ORDER BY 
                f.modified_date DESC
        `, [email]);
        
        // Get files shared with this external user
        const [sharedFiles] = await db.promise().query(`
            SELECT 
                f.file_id,
                f.file_name,
                f.file_type,
                f.file_size,
                f.created_date,
                f.modified_date,
                dfa.permission,
                o.user_name AS owner_name,
                o.user_email AS owner_email,
                dfa.id AS access_id,
                f.is_shared,
                f.is_starred
            FROM 
                drive_file_access dfa
            JOIN 
                drive_files f ON dfa.file_id = f.file_id
            JOIN 
                owner o ON f.user_email = o.user_email
            WHERE 
                dfa.shared_with = ? 
                AND dfa.is_external = 1
                AND dfa.file_id IS NOT NULL
            ORDER BY 
                f.modified_date DESC
        `, [email]);
        
        // Update the last_login time for the external user
        await db.promise().query(
            "UPDATE external_users SET last_login = NOW() WHERE email = ?",
            [email]
        );
        
        // Return the shared items
        res.status(200).json({
            folders: sharedFolders,
            files: sharedFiles
        });
        
    } catch (error) {
        console.error("Error getting shared items for external user:", error);
        res.status(500).json({ error: "Server error while fetching shared items" });
    }
});

// Endpoint to verify external user access to a specific file
router.post('/verify-external-access', async (req, res) => {
    const { email, file_id } = req.body;
    
    if (!email || !file_id) {
        return res.status(400).json({ error: "Email and file_id are required" });
    }
    
    try {
        // Check if the external user has access to this file
        const [access] = await db.promise().query(`
            SELECT permission
            FROM drive_file_access
            WHERE shared_with = ?
            AND file_id = ?
            AND is_external = 1
        `, [email, file_id]);
        
        if (access.length === 0) {
            return res.status(403).json({ error: "Access denied" });
        }
        
        res.status(200).json({
            has_access: true,
            permission: access[0].permission
        });
        
    } catch (error) {
        console.error("Error verifying external access:", error);
        res.status(500).json({ error: "Server error while verifying access" });
    }
});

module.exports = router;