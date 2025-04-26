const express = require("express");
const router = express.Router();
const mysql = require("mysql2");
const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const busboy = require('busboy');

require('dotenv').config();

// Define root directory for file storage - make it absolute to avoid path issues
const rootDirectory = path.join(__dirname, "..", "root");


// Create root directory if it doesn't exist
if (!fs.existsSync(rootDirectory)) {
    fs.mkdirSync(rootDirectory, { recursive: true });
}

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
});

// Helper function to ensure a folder exists on the filesystem
function ensureFolder(folderPath) {
    try {
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        return folderPath;
    } catch (error) {
        console.error(`Error creating directory ${folderPath}:`, error);
        throw error;
    }
}

// Helper function to get folder path for a user - with better debugging
function getUserFolderPath(userEmail, isDrive = true) {
    const userFolder = path.join(rootDirectory, userEmail);
    let finalPath;

    if (isDrive) {
        finalPath = path.join(userFolder, "drive");
    } else {
        finalPath = userFolder;
    }
    return ensureFolder(finalPath);
}

// Helper function to generate a unique filename
function generateUniqueFilename(originalName) {
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    return `${baseName}_${timestamp}_${randomStr}${ext}`;
}

// Create folder function - simplified
// router.post('/create-folder', (req, res) => {
//     const { folder_name, created_by, modified_by, user_email, parent_folder_id } = req.body;
//     const email = user_email || created_by;

//     console.log("Parent folder id", parent_folder_id);
//     // Validate input
//     if (!folder_name || !created_by) {
//         return res.status(400).send('Missing required fields');
//     }

//     // First, ensure user's root directory exists
//     const userBasePath = getUserFolderPath(created_by, false);
//     const userDrivePath = path.join(userBasePath, "drive");
//     try {
//         ensureFolder(userDrivePath);
//     } catch (error) {
//         console.error(`Error ensuring drive directory: ${error.message}`);
//         return res.status(500).send('Error ensuring drive directory: ' + error.message);
//     }

//     // Create physical folder on server
//     const folderPath = path.join(userDrivePath, folder_name);

//     try {
//         // Check if folder already exists
//         if (fs.existsSync(folderPath)) {
//             console.error(`Folder already exists: ${folderPath}`);
//             return res.status(400).send('Folder with this name already exists');
//         }

//         // Create the folder
//         ensureFolder(folderPath);

//         // Also create a database entry for compatibility
//         const query = `INSERT INTO drive_folders (folder_name, created_by, is_root, modified_by, is_shared, user_email)
//                       VALUES (?, ?, true, ?, false, ?)`;

//         db.query(query, [folder_name, created_by, modified_by || created_by, email], (err, result) => {
//             if (err) {
//                 console.error("Error creating folder in database:", err);
//                 // We still created the physical folder, so we'll return success
//                 // Generate a virtual ID for this folder
//                 const folderHash = crypto.createHash('md5').update(folder_name + created_by).digest('hex');
//                 const virtualId = parseInt(folderHash.substring(0, 8), 16);

//                 return res.status(201).send({
//                     message: 'Folder created successfully (physical only)',
//                     folder_id: virtualId,
//                     folder_name: folder_name,
//                     folder_path: folderPath
//                 });
//             }

//             const folder_id = result.insertId;

//             // Return success
//             return res.status(201).send({
//                 message: 'Folder created successfully',
//                 folder_id: folder_id,
//                 folder_path: folderPath,
//                 folder_name: folder_name
//             });
//         });
//     } catch (error) {
//         console.error(`Error creating physical folder: ${error.message}`);
//         return res.status(500).send('Error creating physical folder: ' + error.message);
//     }
// });

router.post('/create-folder', (req, res) => {
    const { folder_name, created_by, modified_by, user_email, parent_folder_id } = req.body;
    const email = user_email || created_by;

    console.log("Parent folder id:", parent_folder_id);

    // Validate input
    if (!folder_name || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // First, ensure user's root directory exists
    const userBasePath = getUserFolderPath(created_by, false);
    const userDrivePath = path.join(userBasePath, "drive");
    try {
        ensureFolder(userDrivePath);
    } catch (error) {
        console.error(`Error ensuring drive directory: ${error.message}`);
        return res.status(500).send('Error ensuring drive directory: ' + error.message);
    }

    // Create physical folder on server
    const folderPath = parent_folder_id
        ? path.join(userDrivePath, parent_folder_id.toString(), folder_name)
        : path.join(userDrivePath, folder_name);

    try {
        // Check if folder already exists
        if (fs.existsSync(folderPath)) {
            console.error(`Folder already exists: ${folderPath}`);
            return res.status(400).send('Folder with this name already exists');
        }

        // Create the physical folder
        ensureFolder(folderPath);

        // Validate parent_folder_id if provided
        const validateParentFolder = (callback) => {
            if (!parent_folder_id) {
                return callback(null);
            }

            const query = `SELECT folder_id FROM drive_folders WHERE folder_id = ?`;
            db.query(query, [parent_folder_id], (err, results) => {
                if (err) {
                    console.error("Error validating parent folder:", err);
                    return callback(`Error validating parent folder: ${err.message}`);
                }
                if (results.length === 0) {
                    return callback(`Parent folder with ID ${parent_folder_id} does not exist`);
                }
                callback(null);
            });
        };

        validateParentFolder((err) => {
            if (err) {
                return res.status(400).send(err);
            }

            // Insert into drive_folders
            const query = `INSERT INTO drive_folders (folder_name, created_by, is_root, modified_by, is_shared, user_email)
                          VALUES (?, ?, ?, ?, ?, ?)`;
            const isRoot = !parent_folder_id; // Set is_root to false if parent_folder_id is provided
            const values = [
                folder_name,
                created_by,
                isRoot,
                modified_by || created_by,
                false,
                email,
            ];

            db.query(query, values, (err, result) => {
                if (err) {
                    console.error("Error creating folder in database:", err);
                    // Physical folder was created, so we'll return success
                    // Generate a virtual ID for this folder
                    const folderHash = crypto.createHash('md5').update(folder_name + created_by).digest('hex');
                    const virtualId = parseInt(folderHash.substring(0, 8), 16);

                    return res.status(201).send({
                        message: 'Folder created successfully (physical only)',
                        folder_id: virtualId,
                        folder_name: folder_name,
                        folder_path: folderPath,
                        parent_folder_id: parent_folder_id || null
                    });
                }

                const folder_id = result.insertId;

                // Insert into drive_folder_structure if parent_folder_id is provided
                if (parent_folder_id) {
                    const structureQuery = `INSERT INTO drive_folder_structure (parent_folder_id, child_folder_id) VALUES (?, ?)`;
                    db.query(structureQuery, [parent_folder_id, folder_id], (err) => {
                        if (err) {
                            console.error("Error inserting into drive_folder_structure:", err);
                            // Folder was created in drive_folders, so still return success
                            return res.status(201).send({
                                message: 'Folder created successfully, but failed to update folder structure',
                                folder_id: folder_id,
                                folder_name: folder_name,
                                folder_path: folderPath,
                                parent_folder_id: parent_folder_id
                            });
                        }

                        // Return success
                        return res.status(201).send({
                            message: 'Folder created successfully',
                            folder_id: folder_id,
                            folder_name: folder_name,
                            folder_path: folderPath,
                            parent_folder_id: parent_folder_id
                        });
                    });
                } else {
                    // No parent_folder_id, return success
                    return res.status(201).send({
                        message: 'Folder created successfully',
                        folder_id: folder_id,
                        folder_name: folder_name,
                        folder_path: folderPath,
                        parent_folder_id: null
                    });
                }
            });
        });
    } catch (error) {
        console.error(`Error creating physical folder: ${error.message}`);
        return res.status(500).send('Error creating physical folder: ' + error.message);
    }
});

// Get folders
router.get('/folders', (req, res) => {
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    const query = `SELECT * FROM drive_folders WHERE created_by = ? OR folder_id IN 
                  (SELECT folder_id FROM drive_folder_access WHERE created_by = ?)`;

    db.query(query, [created_by, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error fetching folders: ' + err.message);
        }
        res.status(200).json(results);
    });
});

// Simplified get_all_files_and_folders route with physical folder detection
router.get('/get_all_files_and_folders/:created_by', (req, res) => {
    const created_by = req.params.created_by;
    const user_email = req.query.user_email || created_by;

    // Validate input
    if (!created_by) {
        return res.status(400).json({ error: 'User email is required' });
    }

    // Get files from database (only where is_root = 1)
    const query_files = `
        SELECT * FROM drive_files 
        WHERE (created_by = ? OR user_email = ?) AND is_root = 1
    `;

    db.query(query_files, [created_by, user_email], (err, files) => {
        if (err) {
            console.error("Error fetching files from database:", err);
            return res.status(500).json({
                error: `Error fetching files: ${err.message}`,
                code: err.code,
                sqlState: err.sqlState,
                sqlMessage: err.sqlMessage
            });
        }

        // Get folders from database (only where is_root = 1)
        const query_folders = `
            SELECT * FROM drive_folders 
            WHERE (created_by = ? OR user_email = ?) AND is_root = 1
        `;

        db.query(query_folders, [created_by, user_email], (err, folders) => {
            if (err) {
                console.error("Error fetching folders from database:", err);
                return res.status(500).json({
                    error: `Error fetching folders: ${err.message}`,
                    code: err.code,
                    sqlState: err.sqlState,
                    sqlMessage: err.sqlMessage
                });
            }

            // Return both files and folders
            res.status(200).json({
                files: files,
                folders: folders
            });
        });
    });
});


// Get Child folders 

router.get('/folder/:folderId/contents', (req, res) => {
    const { folderId } = req.params;
    const { user_email, created_by } = req.query;

    // Validate input
    if (!folderId || !user_email || !created_by) {
        return res.status(400).json({ error: 'Missing required parameters: folderId, user_email, or created_by' });
    }

    console.log(`Getting contents for folder ID: ${folderId} for user: ${user_email}`);

    // Step 1: Get child folder IDs from drive_folder_structure
    const childFolderQuery = `SELECT child_folder_id FROM drive_folder_structure WHERE parent_folder_id = ?`;

    db.query(childFolderQuery, [folderId], (err, childFolderIdsResult) => {
        if (err) {
            console.error("Error fetching child folder IDs from database:", err);
            return res.status(500).json({
                error: `Error fetching child folder IDs: ${err.message}`,
                code: err.code,
                sqlState: err.sqlState,
                sqlMessage: err.sqlMessage
            });
        }

        const childFolderIds = childFolderIdsResult.map(row => row.child_folder_id);

        // Step 2: Get folder details for child folder IDs
        const folderQuery = `SELECT * FROM drive_folders WHERE folder_id IN (?) AND created_by = ?`;
        const fileQuery = `SELECT * FROM drive_files WHERE parent_folder_id = ? AND user_email = ?`;

        // Execute both queries in parallel
        Promise.all([
            new Promise((resolve, reject) => {
                if (childFolderIds.length === 0) {
                    resolve([]);
                } else {
                    db.query(folderQuery, [childFolderIds, created_by], (err, folders) => {
                        if (err) reject(err);
                        else resolve(folders);
                    });
                }
            }),
            new Promise((resolve, reject) => {
                db.query(fileQuery, [folderId, user_email], (err, files) => {
                    if (err) reject(err);
                    else resolve(files);
                });
            })
        ])
            .then(([folders, files]) => {
                // Return both folders and files
                res.status(200).json({
                    success: true,
                    folders: folders,
                    files: files,
                    message: folders.length === 0 && files.length === 0 ? "No folders or files found" : undefined
                });
            })
            .catch(err => {
                console.error("Error fetching contents from database:", err);
                res.status(500).json({
                    error: `Error fetching contents: ${err.message}`,
                    code: err.code,
                    sqlState: err.sqlState,
                    sqlMessage: err.sqlMessage
                });
            });
    });
});


// Get folder by ID
router.get('/folders/:id', (req, res) => {
    const folder_id = req.params.id;
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    const query = `SELECT * FROM drive_folders WHERE folder_id = ? AND 
                  (created_by = ? OR folder_id IN 
                  (SELECT folder_id FROM drive_folder_access WHERE created_by = ?))`;

    db.query(query, [folder_id, created_by, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error fetching folder: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(404).send('Folder not found or no access');
        }

        res.status(200).json(results[0]);
    });
});

// Update folder
router.put('/folders/:id', (req, res) => {
    const folder_id = req.params.id;
    const { folder_name, is_shared, modified_by } = req.body;
    const { created_by, user_email } = req.query;
    const email = user_email || created_by;

    // Validate input
    if (!folder_name || !modified_by) {
        return res.status(400).send('Missing required fields');
    }

    // Check permissions and get current folder data
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (created_by = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE created_by = ? AND permission IN ('WRITE', 'FULL')))`;

    db.query(permCheck, [folder_id, created_by, created_by], (err, results) => {
        if (err) {
            console.error("Error checking permissions:", err);
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (results.length === 0) {
            console.error(`No permission to update folder ${folder_id} or folder not found`);
            return res.status(403).send('No permission to update this folder');
        }

        const currentFolder = results[0];
        console.log("Current folder data:", currentFolder);
        console.log(`Renaming folder from "${currentFolder.folder_name}" to "${folder_name}"`);

        // Update database record
        const updateQuery = `UPDATE drive_folders 
                           SET folder_name = ?, is_shared = ?, modified_by = ? 
                           WHERE folder_id = ?`;

        db.query(updateQuery, [folder_name, is_shared || currentFolder.is_shared, modified_by, folder_id], (err, result) => {
            if (err) {
                console.error("Error updating folder in database:", err);
                return res.status(500).send('Error updating folder: ' + err.message);
            }

            // If folder name changed, rename the physical folder
            if (folder_name !== currentFolder.folder_name) {
                // Get user's drive path
                const userFolder = getUserFolderPath(email || currentFolder.created_by || currentFolder.user_email);
                const oldFolderPath = path.join(userFolder, currentFolder.folder_name);
                const newFolderPath = path.join(userFolder, folder_name);

                console.log(`Attempting to rename folder from "${oldFolderPath}" to "${newFolderPath}"`);

                try {
                    if (fs.existsSync(oldFolderPath)) {
                        fs.renameSync(oldFolderPath, newFolderPath);
                        console.log(`Successfully renamed folder on filesystem`);
                    } else {
                        // Create new folder if old one doesn't exist
                        console.log(`Old folder path not found, creating new folder: ${newFolderPath}`);
                        ensureFolder(newFolderPath);
                    }
                } catch (error) {
                    console.error(`Error renaming physical folder: ${error.message}`);
                    return res.status(500).send('Error renaming physical folder: ' + error.message);
                }
            }

            res.status(200).send({
                message: 'Folder updated successfully',
                affected: result.affectedRows,
                folder_id: folder_id,
                folder_name: folder_name
            });
        });
    });
});

// Delete folder
router.delete('/folders/:id', (req, res) => {
    const folder_id = req.params.id;
    const { created_by, user_email } = req.query;
    const email = user_email || created_by;

    // Validate input
    if (!created_by) {
        console.error("Missing created_by parameter");
        return res.status(400).send('User email is required');
    }

    // Get folder data first
    const getFolderQuery = `SELECT * FROM drive_folders WHERE folder_id = ?`;

    db.query(getFolderQuery, [folder_id], (err, folderResults) => {
        if (err) {
            console.error(`Database error fetching folder ${folder_id}:`, err);
            return res.status(500).send('Error fetching folder: ' + err.message);
        }

        if (folderResults.length === 0) {
            return res.status(404).send('Folder not found');
        }

        const folder = folderResults[0];

        // Check if user is the folder creator or associated with it
        if (folder.created_by === created_by || folder.user_email === email) {
            proceedWithFolderDelete();
            return;
        }

        // Check folder access permissions
        const folderAccessQuery = `SELECT * FROM drive_folder_access 
                                 WHERE folder_id = ? 
                                 AND (created_by = ? OR user_email = ?) 
                                 AND permission = 'FULL'`;

        db.query(folderAccessQuery, [folder_id, created_by, email], (err, accessResults) => {
            if (err) {
                console.error(`Error checking folder access: ${err.message}`);
                return res.status(500).send(`Error checking folder access: ${err.message}`);
            }

            if (accessResults.length > 0) {
                proceedWithFolderDelete();
                return;
            }

            // No permission found
            console.error(`User ${created_by} has no permission to delete folder ${folder_id}`);
            return res.status(403).send('No permission to delete this folder');
        });

        // Function to proceed with folder deletion after permission checks
        function proceedWithFolderDelete() {
            // Get folder path
            const userFolder = getUserFolderPath(folder.created_by || folder.user_email);
            const folderPath = path.join(userFolder, folder.folder_name);

            // Delete physical folder
            try {
                if (fs.existsSync(folderPath)) {
                    deleteFolderContents(folderPath);
                    fs.rmdirSync(folderPath);
                }
            } catch (error) {
                console.error("Error deleting physical folder:", error);
                // Continue with database deletion even if physical delete fails
            }

            // Delete from database
            deleteFolderFromDB(folder_id, created_by, folder.folder_name, res);
        }
    });
});

// Helper function to delete folder contents
function deleteFolderContents(folderPath) {
    if (!fs.existsSync(folderPath)) return;

    fs.readdirSync(folderPath).forEach(file => {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
            // Recursive delete for directories
            deleteFolderContents(curPath);
            fs.rmdirSync(curPath);
        } else {
            // Delete file
            fs.unlinkSync(curPath);
        }
    });
}

// Helper function to delete folder from database
function deleteFolderFromDB(folder_id, created_by, folder_name, res) {

    // Delete folder access records
    db.query('DELETE FROM drive_folder_access WHERE folder_id = ?', [folder_id], (err, result) => {
        if (err) {
            console.error("Error deleting folder access:", err);
        }
        // Delete folder structure records
        db.query('DELETE FROM drive_folder_structure WHERE parent_folder_id = ? OR child_folder_id = ?',
            [folder_id, folder_id], (err, result) => {
                if (err) {
                    console.error("Error deleting folder structure:", err);
                }

                // Delete files in this folder from database
                db.query('SELECT file_id, file_name FROM drive_files WHERE parent_folder_id = ?', [folder_id], (err, files) => {
                    if (err) {
                        console.error("Error finding files in folder:", err);
                    } else {

                        // Delete file access records for all files in folder
                        if (files.length > 0) {
                            const fileIds = files.map(file => file.file_id);

                            db.query('DELETE FROM drive_file_access WHERE file_id IN (?)', [fileIds], (err, result) => {
                                if (err) {
                                    console.error("Error deleting file access:", err);
                                }
                            });
                        }
                    }

                    // Delete files from database
                    db.query('DELETE FROM drive_files WHERE parent_folder_id = ?', [folder_id], (err, result) => {
                        if (err) {
                            console.error("Error deleting files:", err);
                        }

                        // Finally delete the folder record
                        const deleteQuery = `DELETE FROM drive_folders WHERE folder_id = ?`;
                        db.query(deleteQuery, [folder_id], (err, result) => {
                            if (err) {
                                console.error(`Error deleting folder ${folder_id} from database:`, err);
                                return res.status(500).send('Error deleting folder: ' + err.message);
                            }
                            res.status(200).send({
                                message: 'Folder deleted successfully',
                                affected: result.affectedRows,
                                folder_id: folder_id,
                                folder_name: folder_name
                            });
                        });
                    });
                });
            });
    });
}

// Replace the upload-file route to work with physical file system directly
// router.post('/upload-file', (req, res) => {

//     const created_by = req.query.created_by;
//     const user_email = req.query.user_email || created_by; // Use created_by as fallback

//     // Validate input
//     if (!created_by) {
//         return res.status(400).send('Missing created_by parameter');
//     }

//     // Simplified approach - use the user's drive folder directly
//     const userFolder = getUserFolderPath(created_by, false);
//     const drivePath = path.join(userFolder, "drive");

//     try {
//         // Ensure the drive folder exists
//         ensureFolder(drivePath);

//         // Process the upload directly
//         const bb = busboy({
//             headers: req.headers,
//             limits: {
//                 fileSize: 50 * 1024 * 1024, // 50MB limit
//             }
//         });

//         let filesUploaded = 0;
//         let uploadPromises = [];

//         bb.on('file', (name, file, info) => {
//             const { filename, encoding, mimeType } = info;
//             const file_name = filename;
//             const file_type = path.extname(file_name).slice(1);
//             const modified_by = created_by;

//             const uploadPromise = new Promise((resolve, reject) => {
//                 let fileSize = 0;
//                 const chunks = [];

//                 file.on('data', (data) => {
//                     fileSize += data.length;
//                     chunks.push(data);
//                 });

//                 file.on('close', async () => {
//                     const file_size = fileSize / (1024 * 1024); // Convert to MB

//                     try {
//                         // Generate a unique filename to avoid collisions
//                         const uniqueFileName = generateUniqueFilename(file_name);
//                         const destPath = path.join(drivePath, uniqueFileName);

//                         // Write the file to disk
//                         fs.writeFile(destPath, Buffer.concat(chunks), (err) => {
//                             if (err) {
//                                 console.error("Error writing file to disk:", err);
//                                 reject(new Error(`Error saving file to disk: ${err.message}`));
//                                 return;
//                             }


//                             // Get actual file size on disk
//                             const stats = fs.statSync(destPath);
//                             const actualSize = stats.size;
//                             const fileSizeMB = actualSize / (1024 * 1024); // Convert bytes to MB

//                             // Save file metadata to database - we still need this for listing
//                             const insertQuery = `INSERT INTO drive_files 
//                                                (file_name, file_size, file_type, is_shared, created_by, modified_by, file_path, user_email) 
//                                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

//                             db.query(insertQuery, [
//                                 file_name,
//                                 fileSizeMB,
//                                 file_type,
//                                 false, // is_shared
//                                 created_by,
//                                 modified_by,
//                                 destPath,
//                                 user_email
//                             ], (err, result) => {
//                                 if (err) {
//                                     console.error("Database error saving file metadata:", err);
//                                     // Try to remove the file on database error
//                                     try {
//                                         fs.unlinkSync(destPath);
//                                         console.error('Removed file after database failure');
//                                     } catch (e) {
//                                         console.error('Error removing file after DB failure:', e);
//                                     }
//                                     reject(new Error(`Error saving file metadata: ${err.message}`));
//                                     return;
//                                 }

//                                 const fileId = result.insertId;
//                                 const response = {
//                                     message: 'File uploaded successfully',
//                                     file_id: fileId,
//                                     file_path: destPath,
//                                     file_name: file_name,
//                                     file_size: fileSizeMB
//                                 };

//                                 // Only send response for the first file to avoid headers already sent error
//                                 if (!res.headersSent) {
//                                     res.status(201).send(response);
//                                 }

//                                 resolve(response);
//                             });
//                         });
//                     } catch (error) {
//                         console.error("Error processing file:", error);
//                         reject(error);
//                     }
//                 });
//             });

//             uploadPromises.push(uploadPromise);
//             filesUploaded++;
//         });

//         bb.on('finish', async () => {
//             if (filesUploaded === 0) {
//                 return res.status(400).send('No files were uploaded');
//             }

//             try {
//                 await Promise.all(uploadPromises);
//             } catch (error) {
//                 console.error("Error during file upload:", error);
//                 if (!res.headersSent) {
//                     return res.status(500).send(`Error uploading files: ${error.message}`);
//                 }
//             }
//         });

//         bb.on('error', (error) => {
//             console.error("Busboy error:", error);
//             if (!res.headersSent) {
//                 return res.status(500).send(`Upload error: ${error.message}`);
//             }
//         });

//         req.pipe(bb);
//     } catch (error) {
//         console.error(`Error ensuring drive directory: ${error.message}`);
//         return res.status(500).send(`Error ensuring drive directory: ${error.message}`);
//     }
// });
router.post('/upload-file', (req, res) => {
    const created_by = req.query.created_by;
    const user_email = req.query.user_email || created_by;
    let parent_folder_id = req.query.parent_folder_id;
    console.log("Parent folder id", parent_folder_id);

    // Handle parent_folder_id if it's an array (take first value)
    if (Array.isArray(parent_folder_id) && parent_folder_id.length > 0) {
        parent_folder_id = parent_folder_id[0];
        console.log("Using first parent folder id:", parent_folder_id);
    }

    // Validate input
    if (!created_by) {
        return res.status(400).send('Missing created_by parameter');
    }

    // Use the user's drive folder
    const userFolder = getUserFolderPath(created_by, false);
    const drivePath = path.join(userFolder, "drive");

    try {
        // Ensure the drive folder exists
        ensureFolder(drivePath);

        // Validate parent_folder_id if provided and get folder name if it exists
        const validateParentFolder = (callback) => {
            if (!parent_folder_id) {
                return callback(null, null);
            }

            const query = `SELECT folder_id, folder_name FROM drive_folders WHERE folder_id = ?`;
            db.query(query, [parent_folder_id], (err, results) => {
                if (err) {
                    console.error("Error validating parent folder:", err);
                    return callback(`Error validating parent folder: ${err.message}`, null);
                }
                if (results.length === 0) {
                    return callback(`Parent folder with ID ${parent_folder_id} does not exist`, null);
                }
                // Return both null error and the folder name
                callback(null, results[0].folder_name);
            });
        };

        validateParentFolder((err, parentFolderName) => {
            if (err) {
                return res.status(400).send(err);
            }

            // Process the upload
            const bb = busboy({
                headers: req.headers,
                limits: {
                    fileSize: 50 * 1024 * 1024, // 50MB limit
                }
            });

            let filesUploaded = 0;
            let uploadPromises = [];

            bb.on('file', (name, file, info) => {
                const { filename, encoding, mimeType } = info;
                const file_name = filename;
                const file_type = path.extname(file_name).slice(1);
                const modified_by = created_by;

                const uploadPromise = new Promise((resolve, reject) => {
                    let fileSize = 0;
                    const chunks = [];

                    file.on('data', (data) => {
                        fileSize += data.length;
                        chunks.push(data);
                    });

                    file.on('close', async () => {
                        // Store the file size in bytes directly, not MB
                        const file_size_bytes = fileSize;

                        try {
                            // Generate a unique filename to avoid collisions
                            const uniqueFileName = generateUniqueFilename(file_name);

                            let folderPath;
                            if (parent_folder_id) {
                                // If parent folder exists, store in that folder path
                                folderPath = path.join(drivePath, parent_folder_id.toString());
                            } else {
                                // If no parent, store directly in the user's drive root
                                folderPath = drivePath;
                            }

                            // Ensure the destination folder exists
                            ensureFolder(folderPath);

                            // Full path to save the file
                            const destPath = path.join(folderPath, uniqueFileName);

                            // Write the file to disk
                            fs.writeFile(destPath, Buffer.concat(chunks), (err) => {
                                if (err) {
                                    console.error("Error writing file to disk:", err);
                                    reject(new Error(`Error saving file to disk: ${err.message}`));
                                    return;
                                }

                                // Get actual file size on disk in bytes
                                const stats = fs.statSync(destPath);
                                const actualSizeBytes = stats.size;

                                // Save file metadata to database
                                const insertQuery = `INSERT INTO drive_files 
                                                   (file_name, file_size, file_type, is_shared, created_by, modified_by, file_path, user_email, is_root, parent_folder_id) 
                                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                                const is_root = !parent_folder_id; // true if no parent_folder_id, false otherwise

                                db.query(insertQuery, [
                                    file_name,
                                    actualSizeBytes, // Store size in bytes, not MB
                                    file_type,
                                    false, // is_shared
                                    created_by,
                                    modified_by,
                                    destPath,
                                    user_email,
                                    is_root,
                                    parent_folder_id || null
                                ], (err, result) => {
                                    if (err) {
                                        console.error("Database error saving file metadata:", err);
                                        // Try to remove the file on database error
                                        try {
                                            fs.unlinkSync(destPath);
                                            console.error('Removed file after database failure');
                                        } catch (e) {
                                            console.error('Error removing file after DB failure:', e);
                                        }
                                        reject(new Error(`Error saving file metadata: ${err.message}`));
                                        return;
                                    }

                                    const fileId = result.insertId;

                                    // Always insert into drive_folder_structure if parent_folder_id is provided
                                    if (parent_folder_id) {
                                        const structureQuery = `INSERT INTO drive_folder_structure (parent_folder_id, child_file_id) VALUES (?, ?)`;
                                        db.query(structureQuery, [parent_folder_id, fileId], (err) => {
                                            if (err) {
                                                console.error("Error inserting into drive_folder_structure:", err);
                                                // File was saved, so return partial success
                                                const response = {
                                                    message: 'File uploaded successfully, but failed to update folder structure',
                                                    file_id: fileId,
                                                    file_path: destPath,
                                                    file_name: file_name,
                                                    file_size: actualSizeBytes, // Return size in bytes
                                                    parent_folder_id: parent_folder_id
                                                };
                                                if (!res.headersSent) {
                                                    res.status(201).send(response);
                                                }
                                                resolve(response);
                                                return;
                                            }

                                            // Full success
                                            const response = {
                                                message: 'File uploaded successfully',
                                                file_id: fileId,
                                                file_path: destPath,
                                                file_name: file_name,
                                                file_size: actualSizeBytes, // Return size in bytes
                                                parent_folder_id: parent_folder_id
                                            };
                                            if (!res.headersSent) {
                                                res.status(201).send(response);
                                            }
                                            resolve(response);
                                        });
                                    } else {
                                        // No parent_folder_id, return success
                                        const response = {
                                            message: 'File uploaded successfully',
                                            file_id: fileId,
                                            file_path: destPath,
                                            file_name: file_name,
                                            file_size: actualSizeBytes, // Return size in bytes
                                            parent_folder_id: null
                                        };
                                        if (!res.headersSent) {
                                            res.status(201).send(response);
                                        }
                                        resolve(response);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error("Error processing file:", error);
                            reject(error);
                        }
                    });

                    file.on('error', (error) => {
                        console.error("Error with file stream:", error);
                        reject(error);
                    });
                });

                uploadPromises.push(uploadPromise);
                filesUploaded++;
            });

            bb.on('finish', async () => {
                if (filesUploaded === 0) {
                    return res.status(400).send('No files were uploaded');
                }

                try {
                    await Promise.all(uploadPromises);
                } catch (error) {
                    console.error("Error during file upload:", error);
                    if (!res.headersSent) {
                        return res.status(500).send(`Error uploading files: ${error.message}`);
                    }
                }
            });

            bb.on('error', (error) => {
                console.error("Busboy error:", error);
                if (!res.headersSent) {
                    return res.status(500).send(`Upload error: ${error.message}`);
                }
            });

            req.pipe(bb);
        });
    } catch (error) {
        console.error(`Error ensuring drive directory: ${error.message}`);
        return res.status(500).send(`Error ensuring drive directory: ${error.message}`);
    }
});


// Get files with modified parameter handling
router.get('/files', (req, res) => {
    const { parent_folder_id, created_by, is_root } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // If is_root=true, find the root folder for the user
    if (is_root === 'true') {
        // Get the root folder(s) for this user
        const rootQuery = `SELECT folder_id FROM drive_folders 
                         WHERE created_by = ? AND is_root = true`;

        db.query(rootQuery, [created_by], (err, rootFolders) => {
            if (err) {
                return res.status(500).send('Error finding root folder: ' + err.message);
            }

            if (rootFolders.length === 0) {
                // Return empty results instead of creating "My Drive"
                return res.status(200).json({
                    files: [],
                    folders: [],
                    current_folder: null
                });
            }

            // Use the first root folder found
            const rootFolderId = rootFolders[0].folder_id;

            // Get files for this root folder
            getFilesAndFolders(rootFolderId, created_by, res);
        });
        return;
    }

    // If parent_folder_id is provided, use that
    if (!parent_folder_id) {
        return res.status(400).send('Parent folder ID is required if not requesting root');
    }

    // Standard flow with parent_folder_id
    getFilesAndFolders(parent_folder_id, created_by, res);
});

// Helper function to get files and folders for a parent folder
function getFilesAndFolders(parent_folder_id, created_by, res) {
    // Check permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (created_by = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access WHERE created_by = ?))`;

    db.query(permCheck, [parent_folder_id, created_by, created_by], (err, folderResults) => {
        if (err) {
            return res.status(500).send('Error checking folder permissions: ' + err.message);
        }

        if (folderResults.length === 0) {
            return res.status(403).send('No permission to access this folder');
        }

        const currentFolder = folderResults[0];

        // Get subfolders
        const subfolderQuery = `SELECT f.* FROM drive_folders f
                              JOIN drive_folder_structure fs ON f.folder_id = fs.child_folder_id
                              WHERE fs.parent_folder_id = ?`;

        // Get files with explicit mention of file_size
        const fileQuery = `SELECT file_id, file_name, file_size, file_type, parent_folder_id,
                         is_shared, created_date, modified_date, created_by, modified_by 
                         FROM drive_files WHERE parent_folder_id = ?`;

        // Execute both queries in parallel
        db.query(subfolderQuery, [parent_folder_id], (err, folders) => {
            if (err) {
                return res.status(500).send('Error retrieving folders: ' + err.message);
            }

            db.query(fileQuery, [parent_folder_id], (err, files) => {
                if (err) {
                    return res.status(500).send('Error retrieving files: ' + err.message);
                }

                // Log file info including file_size to verify data
                if (files && files.length > 0) {
                    console.log(`Retrieved ${files.length} files, example file:`, {
                        file_id: files[0].file_id,
                        file_name: files[0].file_name,
                        file_size: files[0].file_size,
                        file_type: files[0].file_type
                    });
                }

                res.status(200).json({
                    files: files || [],
                    folders: folders || [],
                    current_folder: {
                        folder_id: currentFolder.folder_id,
                        folder_name: currentFolder.folder_name,
                        is_root: currentFolder.is_root
                    }
                });
            });
        });
    });
}

// Get file by ID
router.get('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { created_by, download } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Check permissions through parent folder
    const permCheck = `SELECT f.*, fold.folder_name, fold.created_by AS folder_owner 
                      FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE f.file_id = ? AND (fold.created_by = ? OR fold.folder_id IN 
                      (SELECT folder_id FROM drive_folder_access WHERE created_by = ?) OR
                      f.file_id IN (SELECT file_id FROM drive_file_access WHERE created_by = ?))`;

    db.query(permCheck, [file_id, created_by, created_by, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('No permission to access this file');
        }

        const fileData = results[0];

        // If download is requested, send the file
        if (download === 'true') {
            if (!fileData.file_path || !fs.existsSync(fileData.file_path)) {
                // Try the default path if file_path is not set
                const userFolder = getUserFolderPath(fileData.folder_owner);
                const defaultPath = path.join(userFolder, fileData.folder_name, fileData.file_name);

                if (!fs.existsSync(defaultPath)) {
                    return res.status(404).send('File not found on server');
                }

                return res.download(defaultPath, fileData.file_name, (err) => {
                    if (err) {
                        return res.status(500).send('Error downloading file: ' + err.message);
                    }
                });
            }

            return res.download(fileData.file_path, fileData.file_name, (err) => {
                if (err) {
                    return res.status(500).send('Error downloading file: ' + err.message);
                }
            });
        } else {
            // Otherwise just return metadata
            delete fileData.file_path; // Don't expose server file path
            res.status(200).json(fileData);
        }
    });
});

// Update file
router.put('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { file_name, file_data, is_shared, modified_by } = req.body;
    const { created_by, user_email } = req.query;
    const email = user_email || created_by;

    // Validate input
    if (!file_name || !modified_by) {
        return res.status(400).send('Missing required fields');
    }

    console.log(`Updating file ${file_id} to name "${file_name}"`);

    // Check permissions and get current file data
    const permCheck = `SELECT f.*, f.created_by AS file_owner, f.user_email AS file_user_email, f.file_path
                      FROM drive_files f
                      WHERE f.file_id = ? AND (f.created_by = ? OR f.user_email = ? OR
                      f.file_id IN (SELECT file_id FROM drive_file_access 
                                  WHERE created_by = ? AND permission IN ('WRITE', 'FULL')))`;

    db.query(permCheck, [file_id, created_by, email, created_by], (err, results) => {
        if (err) {
            console.error("Error checking permissions:", err);
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (results.length === 0) {
            console.error(`No permission to update file ${file_id} or file not found`);
            return res.status(403).send('No permission to update this file or file not found');
        }

        const fileData = results[0];
        console.log("Current file data:", fileData);
        const updateFileContent = file_data && file_data.length > 0;

        // If file content is provided, update the physical file
        if (updateFileContent && fileData.file_path) {
            saveFileFromBase64(file_data, fileData.file_path)
                .catch(error => {
                    console.error('Error updating file content:', error);
                    // Continue anyway to update metadata
                });
        }

        // Update database record
        const updateQuery = `UPDATE drive_files 
                           SET file_name = ?, is_shared = ?, modified_by = ? 
                           WHERE file_id = ?`;

        db.query(updateQuery, [file_name, is_shared || fileData.is_shared, modified_by, file_id], (err, result) => {
            if (err) {
                console.error("Error updating file in database:", err);
                return res.status(500).send('Error updating file: ' + err.message);
            }

            // If file_name changed and we have a file_path, rename the physical file
            if (file_name !== fileData.file_name && fileData.file_path) {
                // Check if the file exists
                if (fs.existsSync(fileData.file_path)) {
                    const dir = path.dirname(fileData.file_path);
                    const fileExt = path.extname(fileData.file_path);
                    const newFileName = file_name + fileExt;
                    const newPath = path.join(dir, newFileName);

                    console.log(`Attempting to rename file from "${fileData.file_path}" to "${newPath}"`);

                    try {
                        fs.renameSync(fileData.file_path, newPath);
                        console.log(`Successfully renamed file on filesystem`);

                        // Update the file path in database
                        db.query('UPDATE drive_files SET file_path = ? WHERE file_id = ?',
                            [newPath, file_id], (err) => {
                                if (err) {
                                    console.error('Error updating file path in database:', err);
                                }
                            });
                    } catch (error) {
                        console.error('Error renaming file on filesystem:', error);
                        // Continue anyway as metadata was updated
                    }
                } else {
                    console.log(`File ${fileData.file_path} not found on filesystem, only updating database`);
                }
            }

            res.status(200).send({
                message: 'File updated successfully',
                affected: result.affectedRows,
                file_id: file_id,
                file_name: file_name
            });
        });
    });
});

// Delete file - simplified approach
router.delete('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { created_by, user_email } = req.query;
    const email = user_email || created_by;


    // Validate input
    if (!created_by) {
        console.error("Missing created_by parameter");
        return res.status(400).send('User email is required');
    }

    // First, get the file data to know what we're deleting
    const getFileQuery = `SELECT * FROM drive_files WHERE file_id = ?`;

    db.query(getFileQuery, [file_id], (err, fileResults) => {
        if (err) {
            console.error(`Database error fetching file ${file_id}:`, err);
            return res.status(500).send('Error fetching file: ' + err.message);
        }

        if (fileResults.length === 0) {
            return res.status(404).send('File not found');
        }

        const fileData = fileResults[0];

        // Simplified permission check - just check if the user created the file
        if (fileData.created_by !== created_by && fileData.user_email !== email) {
            console.error(`User ${created_by} does not own file ${file_id}`);
            return res.status(403).send('You do not have permission to delete this file');
        }

        // Delete the physical file
        if (fileData.file_path && fs.existsSync(fileData.file_path)) {
            try {
                fs.unlinkSync(fileData.file_path);
            } catch (error) {
                console.error(`Error deleting physical file ${fileData.file_path}:`, error);
                // Continue with database deletion even if physical delete fails
            }
        }

        // Delete file record from database
        const deleteQuery = `DELETE FROM drive_files WHERE file_id = ?`;

        db.query(deleteQuery, [file_id], (err, result) => {
            if (err) {
                console.error(`Error deleting file ${file_id} from database:`, err);
                return res.status(500).send('Error deleting file: ' + err.message);
            }

            res.status(200).send({
                message: 'File deleted successfully',
                affected: result.affectedRows,
                file_id: file_id,
                file_name: fileData.file_name
            });
        });
    });
});

// Manage folder structure - add subfolder
router.post('/folder-structure', (req, res) => {
    const { parent_folder_id, child_folder_id } = req.body;
    const { created_by } = req.query;

    // Validate input
    if (!parent_folder_id || !child_folder_id || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // Check permissions on parent folder
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (created_by = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE created_by = ? AND permission IN ('WRITE', 'FULL')))`;

    db.query(permCheck, [parent_folder_id, created_by, created_by], (err, parentResults) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (parentResults.length === 0) {
            return res.status(403).send('No permission to modify this folder structure');
        }

        // Get child folder details
        db.query('SELECT * FROM drive_folders WHERE folder_id = ?', [child_folder_id], (err, childResults) => {
            if (err || childResults.length === 0) {
                return res.status(404).send('Child folder not found');
            }

            const parentFolder = parentResults[0];
            const childFolder = childResults[0];

            // Update database relationship
            const insertQuery = `INSERT INTO drive_folder_structure 
                               (parent_folder_id, child_folder_id) 
                               VALUES (?, ?)`;

            db.query(insertQuery, [parent_folder_id, child_folder_id], (err, result) => {
                if (err) {
                    return res.status(500).send('Error updating folder structure: ' + err.message);
                }

                // Move physical folder if needed
                const parentPath = path.join(getUserFolderPath(parentFolder.created_by), parentFolder.folder_name);
                const childOwnerPath = getUserFolderPath(childFolder.created_by);
                const childCurrentPath = path.join(childOwnerPath, childFolder.folder_name);
                const childNewPath = path.join(parentPath, childFolder.folder_name);

                // Only move if child folder exists and is not already in the right place
                if (fs.existsSync(childCurrentPath) && childCurrentPath !== childNewPath) {
                    try {
                        ensureFolder(path.dirname(childNewPath));
                        fs.renameSync(childCurrentPath, childNewPath);
                    } catch (error) {
                        console.error('Error moving folder:', error);
                        // Continue anyway as database relationship was created
                    }
                }

                res.status(201).send({
                    message: 'Folder structure updated successfully',
                    id: result.insertId
                });
            });
        });
    });
});

// Get subfolders
router.get('/subfolders/:id', (req, res) => {
    const parent_folder_id = req.params.id;
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Check permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (created_by = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access WHERE created_by = ?))`;

    db.query(permCheck, [parent_folder_id, created_by, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('No permission to access this folder');
        }

        const query = `SELECT f.* FROM drive_folders f
                     JOIN drive_folder_structure fs ON f.folder_id = fs.child_folder_id
                     WHERE fs.parent_folder_id = ?`;

        db.query(query, [parent_folder_id], (err, folders) => {
            if (err) {
                return res.status(500).send('Error retrieving subfolders: ' + err.message);
            }

            res.status(200).json(folders);
        });
    });
});

// Manage folder access
router.post('/folder-access', (req, res) => {
    const { folder_id, created_by, permission, shared_public } = req.body;
    const { owner_email } = req.query;

    // Validate input
    if (!folder_id || !created_by || !permission || !owner_email) {
        return res.status(400).send('Missing required fields');
    }

    // Check if requester is folder owner
    const ownerCheck = `SELECT * FROM drive_folders 
                       WHERE folder_id = ? AND created_by = ?`;

    db.query(ownerCheck, [folder_id, owner_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only folder owner can manage access');
        }

        const insertQuery = `INSERT INTO drive_folder_access 
                           (folder_id, created_by, permission, shared_public) 
                           VALUES (?, ?, ?, ?)`;

        db.query(insertQuery, [folder_id, created_by, permission, shared_public], (err, result) => {
            if (err) {
                return res.status(500).send('Error granting folder access: ' + err.message);
            }

            res.status(201).send({
                message: 'Folder access granted successfully',
                id: result.insertId
            });
        });
    });
});

// Get folder access list
router.get('/folder-access/:id', (req, res) => {
    const folder_id = req.params.id;
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Check if requester is folder owner
    const ownerCheck = `SELECT * FROM drive_folders 
                       WHERE folder_id = ? AND created_by = ?`;

    db.query(ownerCheck, [folder_id, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only folder owner can view access list');
        }

        const query = `SELECT * FROM drive_folder_access WHERE folder_id = ?`;

        db.query(query, [folder_id], (err, access) => {
            if (err) {
                return res.status(500).send('Error retrieving folder access: ' + err.message);
            }

            res.status(200).json(access);
        });
    });
});

// Update folder access
router.put('/folder-access/:id', (req, res) => {
    const access_id = req.params.id;
    const { permission, shared_public } = req.body;
    const { created_by } = req.query;

    // Validate input
    if (!permission || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // Check if requester is folder owner
    const ownerCheck = `SELECT f.* FROM drive_folders f
                       JOIN drive_folder_access fa ON f.folder_id = fa.folder_id
                       WHERE fa.id = ? AND f.created_by = ?`;

    db.query(ownerCheck, [access_id, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only folder owner can modify access');
        }

        const updateQuery = `UPDATE drive_folder_access 
                           SET permission = ?, shared_public = ? 
                           WHERE id = ?`;

        db.query(updateQuery, [permission, shared_public, access_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating folder access: ' + err.message);
            }

            res.status(200).send({
                message: 'Folder access updated successfully',
                affected: result.affectedRows
            });
        });
    });
});

// Remove folder access
router.delete('/folder-access/:id', (req, res) => {
    const access_id = req.params.id;
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Check if requester is folder owner
    const ownerCheck = `SELECT f.* FROM drive_folders f
                       JOIN drive_folder_access fa ON f.folder_id = fa.folder_id
                       WHERE fa.id = ? AND f.created_by = ?`;

    db.query(ownerCheck, [access_id, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only folder owner can revoke access');
        }

        const deleteQuery = `DELETE FROM drive_folder_access WHERE id = ?`;

        db.query(deleteQuery, [access_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error revoking folder access: ' + err.message);
            }

            res.status(200).send({
                message: 'Folder access revoked successfully',
                affected: result.affectedRows
            });
        });
    });
});

// Manage file access
router.post('/file-access', (req, res) => {
    const { file_id, created_by, permission, shared_public } = req.body;
    const { owner_email } = req.query;

    // Validate input
    if (!file_id || !created_by || !permission || !owner_email) {
        return res.status(400).send('Missing required fields');
    }

    // Check if requester is file owner (via folder ownership)
    const ownerCheck = `SELECT * FROM drive_files f
                       JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                       WHERE f.file_id = ? AND fold.created_by = ?`;

    db.query(ownerCheck, [file_id, owner_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only file owner can manage access');
        }

        const insertQuery = `INSERT INTO drive_file_access 
                           (file_id, created_by, permission, shared_public) 
                           VALUES (?, ?, ?, ?)`;

        db.query(insertQuery, [file_id, created_by, permission, shared_public], (err, result) => {
            if (err) {
                return res.status(500).send('Error granting file access: ' + err.message);
            }

            res.status(201).send({
                message: 'File access granted successfully',
                id: result.insertId
            });
        });
    });
});

// Get file access list
router.get('/file-access/:id', (req, res) => {
    const file_id = req.params.id;
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Check if requester is file owner
    const ownerCheck = `SELECT * FROM drive_files f
                       JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                       WHERE f.file_id = ? AND fold.created_by = ?`;

    db.query(ownerCheck, [file_id, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only file owner can view access list');
        }

        const query = `SELECT * FROM drive_file_access WHERE file_id = ?`;

        db.query(query, [file_id], (err, access) => {
            if (err) {
                return res.status(500).send('Error retrieving file access: ' + err.message);
            }

            res.status(200).json(access);
        });
    });
});

// Update file access
router.put('/file-access/:id', (req, res) => {
    const access_id = req.params.id;
    const { permission, shared_public } = req.body;
    const { created_by } = req.query;

    // Validate input
    if (!permission || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // Check if requester is file owner
    const ownerCheck = `SELECT fold.* FROM drive_folders fold
                       JOIN drive_files f ON fold.folder_id = f.parent_folder_id
                       JOIN drive_file_access fa ON f.file_id = fa.file_id
                       WHERE fa.id = ? AND fold.created_by = ?`;

    db.query(ownerCheck, [access_id, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only file owner can modify access');
        }

        const updateQuery = `UPDATE drive_file_access 
                           SET permission = ?, shared_public = ? 
                           WHERE id = ?`;

        db.query(updateQuery, [permission, shared_public, access_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating file access: ' + err.message);
            }

            res.status(200).send({
                message: 'File access updated successfully',
                affected: result.affectedRows
            });
        });
    });
});

// Remove file access
router.delete('/file-access/:id', (req, res) => {
    const access_id = req.params.id;
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Check if requester is file owner
    const ownerCheck = `SELECT fold.* FROM drive_folders fold
                       JOIN drive_files f ON fold.folder_id = f.parent_folder_id
                       JOIN drive_file_access fa ON f.file_id = fa.file_id
                       WHERE fa.id = ? AND fold.created_by = ?`;

    db.query(ownerCheck, [access_id, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('Only file owner can revoke access');
        }

        const deleteQuery = `DELETE FROM drive_file_access WHERE id = ?`;

        db.query(deleteQuery, [access_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error revoking file access: ' + err.message);
            }

            res.status(200).send({
                message: 'File access revoked successfully',
                affected: result.affectedRows
            });
        });
    });
});

// Get storage information for a user
router.get('/storage', (req, res) => {
    const { created_by } = req.query;

    // Validate input
    if (!created_by) {
        return res.status(400).send('User email is required');
    }

    // Get user's folder path
    const userFolder = getUserFolderPath(created_by);

    // Calculate storage usage
    let totalSize = 0;

    try {
        // Get all files for this user
        const query = `SELECT SUM(file_size) as total_size FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE fold.created_by = ?`;

        db.query(query, [created_by], (err, results) => {
            if (err) {
                return res.status(500).send('Error calculating storage: ' + err.message);
            }

            totalSize = results[0].total_size || 0;

            // Get storage quota from user settings or use default
            // For now, using a default quota of 10GB
            const storageQuota = 10 * 1024 * 1024 * 1024;

            res.status(200).json({
                used: totalSize,
                total: storageQuota,
                percentage: (totalSize / storageQuota) * 100,
                available: storageQuota - totalSize
            });
        });
    } catch (error) {
        res.status(500).send('Error calculating storage: ' + error.message);
    }
});

// Replace the compatibility upload route with Busboy implementation
router.post('/upload', (req, res) => {
    // Redirect to the upload-file endpoint
    res.redirect(307, `/drive/upload-file${req.url.substring(req.url.indexOf('?'))}`);
});

module.exports = router;
