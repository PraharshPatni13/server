const express = require("express");
const router = express.Router();
const mysql = require("mysql2");



require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {},
});

// Create folder function
router.post('/create-folder', (req, res) => {
    const { folder_name, user_email, is_root, created_by, modified_by, is_shared } = req.body;

    // Validate input
    if (!folder_name || !user_email || !created_by) {
        return res.status(400).send('Missing required fields');
    }

    const query = `INSERT INTO drive_folders (folder_name, user_email, is_root, created_by, modified_by, is_shared)
                   VALUES (?, ?, ?, ?, ?, ?)`;

    db.query(query, [folder_name, user_email, is_root, created_by, modified_by, is_shared], (err, result) => {
        if (err) {
            return res.status(500).send('Error creating folder: ' + err.message);
        }
        res.status(201).send({
            message: 'Folder created successfully',
            folder_id: result.insertId
        });
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
    
    // Check permissions
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
        
        const updateQuery = `UPDATE drive_folders 
                           SET folder_name = ?, is_shared = ?, modified_by = ? 
                           WHERE folder_id = ?`;
        
        db.query(updateQuery, [folder_name, is_shared, modified_by, folder_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating folder: ' + err.message);
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
    
    // Check permissions
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

// Upload file
router.post('/upload-file', (req, res) => {
    const { file_name, file_size, file_type, parent_folder_id, file_data, is_shared, created_by, modified_by } = req.body;
    const { user_email } = req.query;
    
    // Validate input
    if (!file_name || !parent_folder_id || !created_by || !user_email) {
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
        
        const insertQuery = `INSERT INTO drive_files 
                           (file_name, file_size, file_type, parent_folder_id, file_data, is_shared, created_by, modified_by) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        
        db.query(insertQuery, [file_name, file_size, file_type, parent_folder_id, file_data, is_shared, created_by, modified_by], (err, result) => {
            if (err) {
                return res.status(500).send('Error uploading file: ' + err.message);
            }
            
            res.status(201).send({
                message: 'File uploaded successfully',
                file_id: result.insertId
            });
        });
    });
});

// Get files by folder
router.get('/files', (req, res) => {
    const { parent_folder_id, user_email } = req.query;
    
    // Validate input
    if (!parent_folder_id || !user_email) {
        return res.status(400).send('Missing required parameters');
    }
    
    // Check permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ?))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to access this folder');
        }
        
        // Only retrieve file metadata, not file_data
        const query = `SELECT file_id, file_name, file_size, file_type, parent_folder_id, 
                     is_shared, created_date, modified_date, created_by, modified_by 
                     FROM drive_files WHERE parent_folder_id = ?`;
        
        db.query(query, [parent_folder_id], (err, files) => {
            if (err) {
                return res.status(500).send('Error retrieving files: ' + err.message);
            }
            
            res.status(200).json(files);
        });
    });
});

// Get file by ID
router.get('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { user_email, include_data } = req.query;
    
    // Validate input
    if (!user_email) {
        return res.status(400).send('User email is required');
    }
    
    // Check permissions through parent folder
    const permCheck = `SELECT * FROM drive_files f
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
        
        let fields = `file_id, file_name, file_size, file_type, parent_folder_id, 
                    is_shared, created_date, modified_date, created_by, modified_by`;
        
        if (include_data === 'true') {
            fields += `, file_data`;
        }
        
        const query = `SELECT ${fields} FROM drive_files WHERE file_id = ?`;
        
        db.query(query, [file_id], (err, fileData) => {
            if (err) {
                return res.status(500).send('Error retrieving file: ' + err.message);
            }
            
            if (fileData.length === 0) {
                return res.status(404).send('File not found');
            }
            
            res.status(200).json(fileData[0]);
        });
    });
});

// Update file
router.put('/files/:id', (req, res) => {
    const file_id = req.params.id;
    const { file_name, is_shared, modified_by } = req.body;
    const { user_email } = req.query;
    
    // Validate input
    if (!file_name || !modified_by || !user_email) {
        return res.status(400).send('Missing required fields');
    }
    
    // Check permissions
    const permCheck = `SELECT * FROM drive_files f
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
        
        const updateQuery = `UPDATE drive_files 
                           SET file_name = ?, is_shared = ?, modified_by = ? 
                           WHERE file_id = ?`;
        
        db.query(updateQuery, [file_name, is_shared, modified_by, file_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating file: ' + err.message);
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
    
    // Check permissions
    const permCheck = `SELECT * FROM drive_files f
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
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to modify this folder structure');
        }
        
        const insertQuery = `INSERT INTO drive_folder_structure 
                           (parent_folder_id, child_folder_id) 
                           VALUES (?, ?)`;
        
        db.query(insertQuery, [parent_folder_id, child_folder_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating folder structure: ' + err.message);
            }
            
            res.status(201).send({
                message: 'Folder structure updated successfully',
                id: result.insertId
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

// Remove subfolder from parent
router.delete('/folder-structure', (req, res) => {
    const { parent_folder_id, child_folder_id } = req.query;
    const { user_email } = req.query;
    
    // Validate input
    if (!parent_folder_id || !child_folder_id || !user_email) {
        return res.status(400).send('Missing required parameters');
    }
    
    // Check permissions
    const permCheck = `SELECT * FROM drive_folders 
                      WHERE folder_id = ? AND (user_email = ? OR folder_id IN 
                      (SELECT folder_id FROM drive_folder_access 
                       WHERE user_email = ? AND permission IN ('WRITE', 'FULL')))`;
    
    db.query(permCheck, [parent_folder_id, user_email, user_email], (err, results) => {
        if (err) {
            return res.status(500).send('Error checking permissions: ' + err.message);
        }
        
        if (results.length === 0) {
            return res.status(403).send('No permission to modify this folder structure');
        }
        
        const deleteQuery = `DELETE FROM drive_folder_structure 
                           WHERE parent_folder_id = ? AND child_folder_id = ?`;
        
        db.query(deleteQuery, [parent_folder_id, child_folder_id], (err, result) => {
            if (err) {
                return res.status(500).send('Error updating folder structure: ' + err.message);
            }
            
            res.status(200).send({
                message: 'Folder structure updated successfully',
                affected: result.affectedRows
            });
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

module.exports = router;
