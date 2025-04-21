const express = require("express");
const router = express.Router();
const mysql = require("mysql2");
const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');

require('dotenv').config();

// Define root directory for file storage
const rootDirectory = path.join(__dirname, "..", "root", "drive");

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
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
}

// Helper function to get folder path for a user
function getUserFolderPath(userEmail) {
  const userFolder = path.join(rootDirectory, userEmail.replace(/[^a-zA-Z0-9]/g, '_'));
  return ensureFolder(userFolder);
}

// Helper function to save file from base64 data
function saveFileFromBase64(fileData, filePath) {
  return new Promise((resolve, reject) => {
    // Remove data URL prefix if present
    const base64Data = fileData.replace(/^data:[^,]+,/, '');
    
    // Write the file to disk
    fs.writeFile(filePath, base64Data, 'base64', (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(filePath);
    });
  });
}

// Helper function to generate a unique filename
function generateUniqueFilename(originalName) {
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  return `${baseName}_${timestamp}_${randomStr}${ext}`;
}

// Create folder function
router.post('/create-folder', (req, res) => {
    const { folder_name, user_email, is_root, created_by, modified_by, is_shared } = req.body;

    // Validate input
    if (!folder_name || !user_email || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    // Create folder in database
    const query = `INSERT INTO drive_folders (folder_name, user_email, is_root, created_by, modified_by, is_shared)
                   VALUES (?, ?, ?, ?, ?, ?)`;

    db.query(query, [folder_name, user_email, is_root, created_by, modified_by, is_shared], (err, result) => {
        if (err) {
            return res.status(500).send('Error creating folder: ' + err.message);
        }
        
        const folder_id = result.insertId;
        
        // Create physical folder on server
        let folderPath;
        if (is_root) {
            // Root folder is directly in the user's directory
            folderPath = path.join(getUserFolderPath(user_email), folder_name);
        } else {
            // Get parent folder info - default to user's root if not specified
            db.query('SELECT folder_name, user_email FROM drive_folders WHERE folder_id = ?', 
                     [req.body.parent_folder_id || 0], (err, results) => {
                if (err || results.length === 0) {
                    folderPath = path.join(getUserFolderPath(user_email), folder_name);
                } else {
                    // Create in parent folder
                    const parentPath = path.join(getUserFolderPath(results[0].user_email), results[0].folder_name);
                    folderPath = path.join(parentPath, folder_name);
                }
                
                try {
                    ensureFolder(folderPath);
                    return res.status(201).send({
                        message: 'Folder created successfully',
                        folder_id: folder_id,
                        folder_path: folderPath
                    });
                } catch (error) {
                    return res.status(500).send('Error creating physical folder: ' + error.message);
                }
            });
            return; // Return early as we're handling response in the callback
        }
        
        try {
            ensureFolder(folderPath);
            res.status(201).send({
                message: 'Folder created successfully',
                folder_id: folder_id,
                folder_path: folderPath
            });
        } catch (error) {
            res.status(500).send('Error creating physical folder: ' + error.message);
        }
    });
});

// Get folders
router.get('/folders', (req, res) => {
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    const query = `SELECT * FROM drive_folders WHERE user_email = ? OR folder_id IN 
                  (SELECT folder_id FROM drive_folder_access WHERE user_email = ?)`;
    
    db.query(query, [user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error fetching folders: ' + err.message);
        }
        res.status(200).json(results);
    });
});

// Get folder by ID
router.get('/folders/:id', (req, res) => {
    const folder_id = req.params.id;
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    const query = `SELECT * FROM drive_folders WHERE folder_id = ? AND 
                  (user_email = ? OR folder_id IN 
                  (SELECT folder_id FROM drive_folder_access WHERE user_email = ?))`;
    
    db.query(query, [folder_id, user_email, user_email], (err, results) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!folder_name || !modified_by || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check permissions and get current folder data
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission IN ('WRITE', 'FULL')))`;
    
    db.query(permCheck, [folder_id, user_email, user_email], (err, results) => {
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
                const userFolder = getUserFolderPath(currentFolder.user_email);
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check permissions and get folder data
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission = 'FULL'))`;
    
    db.query(permCheck, [folder_id, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to delete this folder');
        }
        
        const folder = results[0];
        
        // Delete physical folder
        const folderPath = path.join(getUserFolderPath(folder.user_email), folder.folder_name);
        try {
            deleteFolderContents(folderPath);
            // Delete the folder itself
            fs.rmdirSync(folderPath);
        } catch (error) {
            console.error("Error deleting physical folder:", error);
            // Continue with database deletion even if physical delete fails
        }
        
        // Delete from database
        deleteFolderFromDB(folder_id, user_email, res);
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
function deleteFolderFromDB(folder_id, user_email, res) {
    // Delete folder access records
    db.query('DELETE FROM drive_folder_access WHERE folder_id = ?', [folder_id], (err) => {
        if (err) {
            console.error("Error deleting folder access:", err);
        }
        
        // Delete folder structure records
        db.query('DELETE FROM drive_folder_structure WHERE parent_folder_id = ? OR child_folder_id = ?', 
                [folder_id, folder_id], (err) => {
            if (err) {
                console.error("Error deleting folder structure:", err);
            }
            
            // Delete files in this folder from database
            db.query('SELECT file_id FROM drive_files WHERE parent_folder_id = ?', [folder_id], (err, files) => {
                if (err) {
                    console.error("Error finding files in folder:", err);
                } else {
                    // Delete file access records for all files in folder
                    if (files.length > 0) {
                        const fileIds = files.map(file => file.file_id);
                        db.query('DELETE FROM drive_file_access WHERE file_id IN (?)', [fileIds], (err) => {
                            if (err) {
                                console.error("Error deleting file access:", err);
                            }
                        });
                    }
                }
                
                // Delete files from database
                db.query('DELETE FROM drive_files WHERE parent_folder_id = ?', [folder_id], (err) => {
                    if (err) {
                        console.error("Error deleting files:", err);
                    }
                    
                    // Finally delete the folder record
                    const deleteQuery = `DELETE FROM drive_folders WHERE folder_id = ?`;
                    db.query(deleteQuery, [folder_id], (err, result) => {
                        if (err) {
                            return res.status(500).send('Error deleting folder: ' + err.message);
                        }
                        
                        res.status(200).send({
                            message: 'Folder deleted successfully',
                            affected: result.affectedRows
                        });
                    });
                });
            });
        });
    });
}

// Upload file - using direct file handling
router.post('/upload-file', (req, res) => {
    const { file_name, file_data, file_size, file_type, parent_folder_id, is_shared, created_by, modified_by } = req.body;
    const { user_email } = req.query;
    
    // Validate input
    if (!file_name || !file_data || !parent_folder_id || !created_by || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check folder permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission IN ('WRITE', 'FULL')))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to upload to this folder');
        }
        
        const folder = results[0];
        
        // Set up file path
        const userFolder = getUserFolderPath(folder.user_email);
        const destFolder = path.join(userFolder, folder.folder_name);
        ensureFolder(destFolder);
        
        const uniqueFileName = generateUniqueFilename(file_name);
        const destPath = path.join(destFolder, uniqueFileName);
        
        // Save the file from base64 data
        saveFileFromBase64(file_data, destPath)
            .then(() => {
                // Get actual file size on disk
                const stats = fs.statSync(destPath);
                const actualSize = stats.size;
                
                // Save file metadata to database (without storing file_data in DB)
                const insertQuery = `INSERT INTO drive_files 
                                   (file_name, file_size, file_type, parent_folder_id, file_path, is_shared, created_by, modified_by) 
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
                
                db.query(insertQuery, [
                    file_name, 
                    actualSize || file_size, 
                    file_type, 
                    parent_folder_id, 
                    destPath,
                    is_shared || false, 
                    created_by, 
                    modified_by || created_by
                ], (err, result) => {
                    if (err) {
                        // Try to remove the file on database error
                        try {
                            fs.unlinkSync(destPath);
                        } catch (e) {
                            console.error('Error removing file after DB failure:', e);
                        }
                        return res.status(500).send('Error saving file metadata: ' + err.message);
                    }
                    
                    res.status(201).send({
                        message: 'File uploaded successfully',
                        file_id: result.insertId,
                        file_path: destPath
                    });
                });
            })
            .catch(error => {
                res.status(500).send('Error saving file: ' + error.message);
            });
    });
});

// Get files with modified parameter handling
router.get('/files', (req, res) => {
    const { parent_folder_id, user_email, is_root } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // If is_root=true, find the root folder for the user
    if (is_root === 'true') {
        // Get the root folder(s) for this user
        const rootQuery = `SELECT folder_id FROM drive_folders 
                         WHERE user_email = ? AND is_root = true`;
        
        db.query(rootQuery, [user_email], (err, rootFolders) => {
            if (err) {
                return res.status(500).send('Error finding root folder: ' + err.message);
            }
            
            if (rootFolders.length === 0) {
                // Create a root folder if none exists
                const rootName = 'My Drive';
                const insertQuery = `INSERT INTO drive_folders 
                                   (folder_name, user_email, is_root, created_by, modified_by, is_shared)
                                   VALUES (?, ?, true, ?, ?, false)`;
                
                db.query(insertQuery, [rootName, user_email, user_email, user_email], (err, result) => {
                    if (err) {
                        return res.status(500).send('Error creating root folder: ' + err.message);
                    }
                    
                    const newRootId = result.insertId;
                    
                    // Create physical folder
                    const folderPath = path.join(getUserFolderPath(user_email), rootName);
                    ensureFolder(folderPath);
                    
                    // Now get files for this new root folder (there will be none initially)
                    return res.status(200).json({
                        files: [],
                        folders: [{
                            folder_id: newRootId,
                            folder_name: rootName,
                            user_email: user_email,
                            is_root: true,
                            created_by: user_email,
                            modified_by: user_email,
                            is_shared: false,
                            created_date: new Date(),
                            modified_date: new Date()
                        }],
                        current_folder: {
                            folder_id: newRootId,
                            folder_name: rootName,
                            is_root: true
                        }
                    });
                });
                return;
            }
            
            // Use the first root folder found
            const rootFolderId = rootFolders[0].folder_id;
            
            // Get files for this root folder
            getFilesAndFolders(rootFolderId, user_email, res);
        });
        return;
    }
    
    // If parent_folder_id is provided, use that
    if (!parent_folder_id) {
        return res.status(400).send('Parent folder ID is required if not requesting root');
    }
    
    // Standard flow with parent_folder_id
    getFilesAndFolders(parent_folder_id, user_email, res);
});

// Helper function to get files and folders for a parent folder
function getFilesAndFolders(parent_folder_id, user_email, res) {
    // Check permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access WHERE user_email = ?))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, folderResults) => {
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
    const { user_email, download } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check permissions through parent folder
    const permCheck = `SELECT f.*, fold.folder_name, fold.user_email AS folder_owner 
                      FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE f.file_id = ? AND (fold.user_email = ? OR fold.folder_id IN 
                      (SELECT folder_id FROM drive_folder_access WHERE user_email = ?) OR
                      f.file_id IN (SELECT file_id FROM drive_file_access WHERE user_email = ?))`;
    
    db.query(permCheck, [file_id, user_email, user_email, user_email], (err, results) => {
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
                return res.status(404).send('File not found on server');
            }
            
            return res.download(fileData.file_path, fileData.file_name, (err) => {
                if (err) {
                    return res.status(500).send('Error downloading file: ' + err.message);
                }
            });
        } else if (download === 'content') {
            // If content is requested, read file and return base64
            if (!fileData.file_path || !fs.existsSync(fileData.file_path)) {
                return res.status(404).send('File not found on server');
            }
            
            fs.readFile(fileData.file_path, (err, data) => {
                if (err) {
                    return res.status(500).send('Error reading file: ' + err.message);
                }
                
                const base64Data = data.toString('base64');
                const fileInfo = { ...fileData, file_data: base64Data };
                delete fileInfo.file_path; // Don't expose server path
                
                res.status(200).json(fileInfo);
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
    const { user_email } = req.query;
    
    // Validate input
    if (!file_name || !modified_by || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check permissions and get current file data
    const permCheck = `SELECT f.*, fold.folder_name, fold.user_email AS folder_owner 
                      FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE f.file_id = ? AND (fold.user_email = ? OR fold.folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission IN ('WRITE', 'FULL')) OR
                      f.file_id IN (SELECT file_id FROM drive_file_access 
                                  WHERE user_email = ? AND permission IN ('WRITE', 'FULL')))`;
    
    db.query(permCheck, [file_id, user_email, user_email, user_email], (err, results) => {
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

// Delete file
router.delete('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check permissions and get file data
    const permCheck = `SELECT f.*, fold.user_email AS folder_owner
                      FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE f.file_id = ? AND (fold.user_email = ? OR fold.folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission = 'FULL') OR
                      f.file_id IN (SELECT file_id FROM drive_file_access 
                                  WHERE user_email = ? AND permission = 'FULL'))`;
    
    db.query(permCheck, [file_id, user_email, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to delete this file');
        }
        
        const fileData = results[0];
        
        // Delete the physical file if it exists
        if (fileData.file_path && fs.existsSync(fileData.file_path)) {
            try {
                fs.unlinkSync(fileData.file_path);
            } catch (error) {
                console.error('Error deleting physical file:', error);
                // Continue with database deletion even if physical delete fails
            }
        }
        
        // Delete file access records
        db.query('DELETE FROM drive_file_access WHERE file_id = ?', [file_id], (err) => {
            if (err) {
                console.error('Error deleting file access records:', err);
            }
            
            // Delete file record from database
            const deleteQuery = `DELETE FROM drive_files WHERE file_id = ?`;
            
            db.query(deleteQuery, [file_id], (err, result) => {
                if (err) {
                    return res.status(500).send('Error deleting file: ' + err.message);
                }
                
                res.status(200).send({
                    message: 'File deleted successfully',
                    affected: result.affectedRows
                });
            });
        });
    });
});

// Manage folder structure - add subfolder
router.post('/folder-structure', (req, res) => {
    const { parent_folder_id, child_folder_id } = req.body;
    const { user_email } = req.query;
    
    // Validate input
    if (!parent_folder_id || !child_folder_id || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check permissions on parent folder
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission IN ('WRITE', 'FULL')))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, parentResults) => {
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
                const parentPath = path.join(getUserFolderPath(parentFolder.user_email), parentFolder.folder_name);
                const childOwnerPath = getUserFolderPath(childFolder.user_email);
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access WHERE user_email = ?))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, results) => {
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
    const { folder_id, user_email, permission, shared_public } = req.body;
    const { owner_email } = req.query;
    
    // Validate input
    if (!folder_id || !user_email || !permission || !owner_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check if requester is folder owner
    const ownerCheck = `SELECT * FROM drive_folders 
                       WHERE folder_id = ? AND user_email = ?`;
    
    db.query(ownerCheck, [folder_id, owner_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('Only folder owner can manage access');
        }
        
        const insertQuery = `INSERT INTO drive_folder_access 
                           (folder_id, user_email, permission, shared_public) 
                           VALUES (?, ?, ?, ?)`;
        
        db.query(insertQuery, [folder_id, user_email, permission, shared_public], (err, result) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check if requester is folder owner
    const ownerCheck = `SELECT * FROM drive_folders 
                       WHERE folder_id = ? AND user_email = ?`;
    
    db.query(ownerCheck, [folder_id, user_email], (err, results) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!permission || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check if requester is folder owner
    const ownerCheck = `SELECT f.* FROM drive_folders f
                       JOIN drive_folder_access fa ON f.folder_id = fa.folder_id
                       WHERE fa.id = ? AND f.user_email = ?`;
    
    db.query(ownerCheck, [access_id, user_email], (err, results) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check if requester is folder owner
    const ownerCheck = `SELECT f.* FROM drive_folders f
                       JOIN drive_folder_access fa ON f.folder_id = fa.folder_id
                       WHERE fa.id = ? AND f.user_email = ?`;
    
    db.query(ownerCheck, [access_id, user_email], (err, results) => {
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
    const { file_id, user_email, permission, shared_public } = req.body;
    const { owner_email } = req.query;
    
    // Validate input
    if (!file_id || !user_email || !permission || !owner_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check if requester is file owner (via folder ownership)
    const ownerCheck = `SELECT * FROM drive_files f
                       JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                       WHERE f.file_id = ? AND fold.user_email = ?`;
    
    db.query(ownerCheck, [file_id, owner_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking ownership: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('Only file owner can manage access');
        }
        
        const insertQuery = `INSERT INTO drive_file_access 
                           (file_id, user_email, permission, shared_public) 
                           VALUES (?, ?, ?, ?)`;
        
        db.query(insertQuery, [file_id, user_email, permission, shared_public], (err, result) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check if requester is file owner
    const ownerCheck = `SELECT * FROM drive_files f
                       JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                       WHERE f.file_id = ? AND fold.user_email = ?`;
    
    db.query(ownerCheck, [file_id, user_email], (err, results) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!permission || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check if requester is file owner
    const ownerCheck = `SELECT fold.* FROM drive_folders fold
                       JOIN drive_files f ON fold.folder_id = f.parent_folder_id
                       JOIN drive_file_access fa ON f.file_id = fa.file_id
                       WHERE fa.id = ? AND fold.user_email = ?`;
    
    db.query(ownerCheck, [access_id, user_email], (err, results) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check if requester is file owner
    const ownerCheck = `SELECT fold.* FROM drive_folders fold
                       JOIN drive_files f ON fold.folder_id = f.parent_folder_id
                       JOIN drive_file_access fa ON f.file_id = fa.file_id
                       WHERE fa.id = ? AND fold.user_email = ?`;
    
    db.query(ownerCheck, [access_id, user_email], (err, results) => {
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
    const { user_email } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Get user's folder path
    const userFolder = getUserFolderPath(user_email);
    
    // Calculate storage usage
    let totalSize = 0;
    
    try {
        // Get all files for this user
        const query = `SELECT SUM(file_size) as total_size FROM drive_files f
                      JOIN drive_folders fold ON f.parent_folder_id = fold.folder_id
                      WHERE fold.user_email = ?`;
        
        db.query(query, [user_email], (err, results) => {
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

// Add compatibility route for upload
router.post('/upload', (req, res) => {
    // Forward to the upload-file route
    const { file_name, file_data, file_size, file_type, parent_folder_id, is_shared, created_by, modified_by } = req.body;
    const { user_email } = req.query;
    
    // Validate input
    if (!file_name || !file_data || !parent_folder_id || !created_by || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check folder permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission IN ('WRITE', 'FULL')))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to upload to this folder');
        }
        
        const folder = results[0];
        
        // Set up file path
        const userFolder = getUserFolderPath(folder.user_email);
        const destFolder = path.join(userFolder, folder.folder_name);
        ensureFolder(destFolder);
        
        const uniqueFileName = generateUniqueFilename(file_name);
        const destPath = path.join(destFolder, uniqueFileName);
        
        // Save the file from base64 data
        saveFileFromBase64(file_data, destPath)
            .then(() => {
                // Get actual file size on disk
                const stats = fs.statSync(destPath);
                const actualSize = stats.size;
                
                // Save file metadata to database (without storing file_data in DB)
                const insertQuery = `INSERT INTO drive_files 
                                   (file_name, file_size, file_type, parent_folder_id, file_path, is_shared, created_by, modified_by) 
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
                
                db.query(insertQuery, [
                    file_name, 
                    actualSize || file_size, 
                    file_type, 
                    parent_folder_id, 
                    destPath,
                    is_shared || false, 
                    created_by, 
                    modified_by || created_by
                ], (err, result) => {
                    if (err) {
                        // Try to remove the file on database error
                        try {
                            fs.unlinkSync(destPath);
                        } catch (e) {
                            console.error('Error removing file after DB failure:', e);
                        }
                        return res.status(500).send('Error saving file metadata: ' + err.message);
                    }
                    
                    res.status(201).send({
                        message: 'File uploaded successfully',
                        file_id: result.insertId,
                        file_path: destPath
                    });
                });
            })
            .catch(error => {
                res.status(500).send('Error saving file: ' + error.message);
            });
    });
});

module.exports = router;
