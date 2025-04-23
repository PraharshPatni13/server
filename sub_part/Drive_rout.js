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
console.log("Root directory for storage:", rootDirectory);


// Create root directory if it doesn't exist
if (!fs.existsSync(rootDirectory)) {
    console.log("Creating root directory:", rootDirectory);
    fs.mkdirSync(rootDirectory, { recursive: true });
}

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
  });
// Add error handling for database connection
db.connect(err => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to database');
    }
});


// Helper function to ensure a folder exists on the filesystem
function ensureFolder(folderPath) {
    try {
        if (!fs.existsSync(folderPath)) {
            console.log(`Creating directory: ${folderPath}`);
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

    console.log(`Creating folder path: ${finalPath} for user: ${userEmail}`);
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
router.post('/create-folder', (req, res) => {
    const { folder_name, created_by, modified_by, user_email } = req.body;
    const email = user_email || created_by;

    // Validate input
    if (!folder_name || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    console.log(`Creating folder: ${folder_name} for user: ${created_by}`);

    // First, ensure user's root directory exists
    const userBasePath = getUserFolderPath(created_by, false);
    const userDrivePath = path.join(userBasePath, "drive");
    try {
        ensureFolder(userDrivePath);
        console.log(`Ensured drive directory exists at: ${userDrivePath}`);
    } catch (error) {
        console.error(`Error ensuring drive directory: ${error.message}`);
        return res.status(500).send('Error ensuring drive directory: ' + error.message);
    }

    // Create physical folder on server
    const folderPath = path.join(userDrivePath, folder_name);
    
    try {
        // Check if folder already exists
        if (fs.existsSync(folderPath)) {
            console.error(`Folder already exists: ${folderPath}`);
            return res.status(400).send('Folder with this name already exists');
        }
        
        // Create the folder
        ensureFolder(folderPath);
        console.log(`Creating directory: ${folderPath}`);
        console.log(`Physical folder created at: ${folderPath}`);
        
        // Also create a database entry for compatibility
        const query = `INSERT INTO drive_folders (folder_name, created_by, is_root, modified_by, is_shared, user_email)
                      VALUES (?, ?, true, ?, false, ?)`;

        db.query(query, [folder_name, created_by, modified_by || created_by, email], (err, result) => {
            if (err) {
                console.error("Error creating folder in database:", err);
                // We still created the physical folder, so we'll return success
                // Generate a virtual ID for this folder
                const folderHash = crypto.createHash('md5').update(folder_name + created_by).digest('hex');
                const virtualId = parseInt(folderHash.substring(0, 8), 16);
                
                return res.status(201).send({
                    message: 'Folder created successfully (physical only)',
                    folder_id: virtualId,
                    folder_name: folder_name,
                    folder_path: folderPath
                });
            }

            const folder_id = result.insertId;
            console.log(`Created folder in database with ID: ${folder_id}, name: ${folder_name}`);
            
            // Return success
            return res.status(201).send({
                message: 'Folder created successfully',
                folder_id: folder_id,
                folder_path: folderPath,
                folder_name: folder_name
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

    console.log(`Fetching all files and folders for user: ${created_by}`);

    // Get files from database
    const query_files = `SELECT * FROM drive_files WHERE created_by = ? OR user_email = ?`;
    
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
        
        console.log(`Retrieved ${files.length} files from database`);
        
        // Get folders from database
        const query_folders = `SELECT * FROM drive_folders WHERE created_by = ? OR user_email = ?`;
        
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
            
            console.log(`Retrieved ${folders.length} folders from database`);
            
            // Return both files and folders from database
            res.status(200).json({
                files: files,
                folders: folders
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
    const { created_by } = req.query;

    // Validate input
    if (!folder_name || !modified_by || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // Check permissions and get current folder data
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (created_by = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE created_by = ? AND permission IN ('WRITE', 'FULL')))`;

    db.query(permCheck, [folder_id, created_by, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('No permission to update this folder');
        }

        const currentFolder = results[0];

        // Update database record
        const updateQuery = `UPDATE drive_folders 
                           SET folder_name = ?, is_shared = ?, modified_by = ? 
                           WHERE folder_id = ?`;

        db.query(updateQuery, [folder_name, is_shared, modified_by, folder_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating folder: ' + err.message);
            }

            // If folder name changed, rename the physical folder
            if (folder_name !== currentFolder.folder_name) {
                // Get parent folder path
                const userFolder = getUserFolderPath(currentFolder.created_by);
                const oldFolderPath = path.join(userFolder, currentFolder.folder_name);
                const newFolderPath = path.join(userFolder, folder_name);

                try {
                    if (fs.existsSync(oldFolderPath)) {
                        fs.renameSync(oldFolderPath, newFolderPath);
                    } else {
                        // Create new folder if old one doesn't exist
                        ensureFolder(newFolderPath);
                    }
                } catch (error) {
                    return res.status(500).send('Error renaming physical folder: ' + error.message);
                }
            }

            res.status(200).send({
                message: 'Folder updated successfully',
                affected: result.affectedRows
            });
        });
    });
});

// Delete folder
router.delete('/folders/:id', (req, res) => {
    const folder_id = req.params.id;
    const { created_by, user_email } = req.query;
    const email = user_email || created_by;

    console.log(`Request to delete folder ID: ${folder_id} from user: ${created_by}`);

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
            console.log(`Folder ${folder_id} not found in database`);
            return res.status(404).send('Folder not found');
        }
        
        const folder = folderResults[0];
        console.log(`Found folder: ${folder.folder_name} (ID: ${folder.folder_id})`);
        
        // Check if user is the folder creator or associated with it
        if (folder.created_by === created_by || folder.user_email === email) {
            console.log(`User is direct owner of the folder`);
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
                console.log(`User has folder access permission`);
                proceedWithFolderDelete();
                return;
            }
            
            // No permission found
            console.error(`User ${created_by} has no permission to delete folder ${folder_id}`);
            return res.status(403).send('No permission to delete this folder');
        });
        
        // Function to proceed with folder deletion after permission checks
        function proceedWithFolderDelete() {
            console.log(`Preparing to delete folder: ${folder.folder_name} (ID: ${folder.folder_id})`);
            
            // Get folder path
            const userFolder = getUserFolderPath(folder.created_by || folder.user_email);
            const folderPath = path.join(userFolder, folder.folder_name);
            
            // Delete physical folder
            try {
                if (fs.existsSync(folderPath)) {
                    console.log(`Deleting physical folder at: ${folderPath}`);
                    deleteFolderContents(folderPath);
                    // Delete the folder itself
                    fs.rmdirSync(folderPath);
                    console.log(`Physical folder deleted: ${folderPath}`);
                } else {
                    console.log(`Folder not found at expected path: ${folderPath}`);
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
    console.log(`Deleting folder ID ${folder_id} from database`);
    
    // Delete folder access records
    db.query('DELETE FROM drive_folder_access WHERE folder_id = ?', [folder_id], (err, result) => {
        if (err) {
            console.error("Error deleting folder access:", err);
        } else {
            console.log(`Folder access records deleted. Affected rows: ${result.affectedRows}`);
        }

        // Delete folder structure records
        db.query('DELETE FROM drive_folder_structure WHERE parent_folder_id = ? OR child_folder_id = ?',
            [folder_id, folder_id], (err, result) => {
                if (err) {
                    console.error("Error deleting folder structure:", err);
                } else {
                    console.log(`Folder structure records deleted. Affected rows: ${result.affectedRows}`);
                }

                // Delete files in this folder from database
                db.query('SELECT file_id, file_name FROM drive_files WHERE parent_folder_id = ?', [folder_id], (err, files) => {
                    if (err) {
                        console.error("Error finding files in folder:", err);
                    } else {
                        console.log(`Found ${files.length} files in folder to delete`);
                        
                        // Delete file access records for all files in folder
                        if (files.length > 0) {
                            const fileIds = files.map(file => file.file_id);
                            console.log(`Deleting access records for files: ${fileIds.join(', ')}`);
                            
                            db.query('DELETE FROM drive_file_access WHERE file_id IN (?)', [fileIds], (err, result) => {
                                if (err) {
                                    console.error("Error deleting file access:", err);
                                } else {
                                    console.log(`File access records deleted. Affected rows: ${result.affectedRows}`);
                                }
                            });
                        }
                    }

                    // Delete files from database
                    db.query('DELETE FROM drive_files WHERE parent_folder_id = ?', [folder_id], (err, result) => {
                        if (err) {
                            console.error("Error deleting files:", err);
                        } else {
                            console.log(`Files deleted from database. Affected rows: ${result.affectedRows}`);
                        }

                        // Finally delete the folder record
                        const deleteQuery = `DELETE FROM drive_folders WHERE folder_id = ?`;
                        db.query(deleteQuery, [folder_id], (err, result) => {
                            if (err) {
                                console.error(`Error deleting folder ${folder_id} from database:`, err);
                                return res.status(500).send('Error deleting folder: ' + err.message);
                            }

                            console.log(`Folder record deleted. Affected rows: ${result.affectedRows}`);
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
router.post('/upload-file', (req, res) => {
    console.log("Upload request received");
    
    const created_by = req.query.created_by;
    const user_email = req.query.user_email || created_by; // Use created_by as fallback
    
    // Validate input
    if (!created_by) {
        return res.status(400).send('Missing created_by parameter');
    }
    
    // Simplified approach - use the user's drive folder directly
    const userFolder = getUserFolderPath(created_by, false);
    const drivePath = path.join(userFolder, "drive");
    
    try {
        // Ensure the drive folder exists
        ensureFolder(drivePath);
        console.log(`Ensured user drive folder exists at: ${drivePath}`);
        
        // Process the upload directly
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
            console.log(`Received file [${name}]: filename=${filename}, encoding=${encoding}, mimeType=${mimeType}`);
            
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
                    const file_size = fileSize / (1024 * 1024); // Convert to MB
                    console.log(`File [${file_name}] finished, size=${file_size}MB`);
                    
                    try {
                        // Generate a unique filename to avoid collisions
                        const uniqueFileName = generateUniqueFilename(file_name);
                        const destPath = path.join(drivePath, uniqueFileName);
                        console.log(`Saving file directly to: ${destPath}`);
                        
                        // Write the file to disk
                        fs.writeFile(destPath, Buffer.concat(chunks), (err) => {
                            if (err) {
                                console.error("Error writing file to disk:", err);
                                reject(new Error(`Error saving file to disk: ${err.message}`));
                                return;
                            }
                            
                            console.log("File saved successfully to disk:", destPath);
                            
                            // Get actual file size on disk
                            const stats = fs.statSync(destPath);
                            const actualSize = stats.size;
                            const fileSizeMB = actualSize / (1024 * 1024); // Convert bytes to MB
                            
                            // Save file metadata to database - we still need this for listing
                            const insertQuery = `INSERT INTO drive_files 
                                               (file_name, file_size, file_type, is_shared, created_by, modified_by, file_path, user_email) 
                                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
                            
                            db.query(insertQuery, [
                                file_name,
                                fileSizeMB, 
                                file_type,
                                false, // is_shared
                                created_by,
                                modified_by,
                                destPath,
                                user_email
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
                                console.log(`File upload complete, database updated with ID: ${fileId}`);
                                
                                const response = {
                                    message: 'File uploaded successfully',
                                    file_id: fileId,
                                    file_path: destPath,
                                    file_name: file_name,
                                    file_size: fileSizeMB
                                };
                                
                                // Only send response for the first file to avoid headers already sent error
                                if (!res.headersSent) {
                                    res.status(201).send(response);
                                }
                                
                                resolve(response);
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
            console.log("Finished parsing form");
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

        // Get files
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
    const { created_by } = req.query;

    // Validate input
    if (!file_name || !modified_by || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // Check permissions and get current file data
    const permCheck = `SELECT f.*, fold.folder_name, fold.created_by AS folder_owner 
                      FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE f.file_id = ? AND (fold.created_by = ? OR fold.folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE created_by = ? AND permission IN ('WRITE', 'FULL')) OR
                      f.file_id IN (SELECT file_id FROM drive_file_access 
                                  WHERE created_by = ? AND permission IN ('WRITE', 'FULL')))`;

    db.query(permCheck, [file_id, created_by, created_by, created_by], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }

        if (results.length === 0) {
            return res.status(403).send('No permission to update this file');
        }

        const fileData = results[0];
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

        db.query(updateQuery, [file_name, is_shared, modified_by, file_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating file: ' + err.message);
            }

            // If file_name changed and we have a file_path, rename the physical file
            if (file_name !== fileData.file_name && fileData.file_path && fs.existsSync(fileData.file_path)) {
                const dir = path.dirname(fileData.file_path);
                const fileExt = path.extname(fileData.file_path);
                const uniqueFileName = generateUniqueFilename(file_name);
                const newPath = path.join(dir, uniqueFileName);

                try {
                    fs.renameSync(fileData.file_path, newPath);

                    // Update the file path in database
                    db.query('UPDATE drive_files SET file_path = ? WHERE file_id = ?',
                        [newPath, file_id], (err) => {
                            if (err) {
                                console.error('Error updating file path:', err);
                            }
                        });
                } catch (error) {
                    console.error('Error renaming file:', error);
                    // Continue anyway as metadata was updated
                }
            }

            res.status(200).send({
                message: 'File updated successfully',
                affected: result.affectedRows
            });
        });
    });
});

// Delete file - simplified approach
router.delete('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { created_by, user_email } = req.query;
    const email = user_email || created_by;

    console.log(`Request to delete file ID: ${file_id} from user: ${created_by}`);

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
            console.log(`File ${file_id} not found in database`);
            return res.status(404).send('File not found');
        }
        
        const fileData = fileResults[0];
        console.log(`Found file: ${fileData.file_name} (ID: ${fileData.file_id})`);
        
        // Simplified permission check - just check if the user created the file
        if (fileData.created_by !== created_by && fileData.user_email !== email) {
            console.error(`User ${created_by} does not own file ${file_id}`);
            return res.status(403).send('You do not have permission to delete this file');
        }
        
        // Delete the physical file
        if (fileData.file_path && fs.existsSync(fileData.file_path)) {
            try {
                fs.unlinkSync(fileData.file_path);
                console.log(`Physical file deleted: ${fileData.file_path}`);
            } catch (error) {
                console.error(`Error deleting physical file ${fileData.file_path}:`, error);
                // Continue with database deletion even if physical delete fails
            }
        } else {
            console.log(`Physical file not found at path: ${fileData.file_path}`);
        }

        // Delete file record from database
        const deleteQuery = `DELETE FROM drive_files WHERE file_id = ?`;

        db.query(deleteQuery, [file_id], (err, result) => {
            if (err) {
                console.error(`Error deleting file ${file_id} from database:`, err);
                return res.status(500).send('Error deleting file: ' + err.message);
            }

            console.log(`File ${file_id} deleted successfully from database. Affected rows: ${result.affectedRows}`);
            
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
