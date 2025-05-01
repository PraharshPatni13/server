const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const JWT_SECRET_KEY = 'Jwt_key_for_photography_website';

const AdminSystemConfiguration = {
  JWT: {
    SECRET: 'Jwt_key_for_photography_website',
    ALGORITHM: 'HS256',
    EXPIRY: '24h'
  },
  DATABASE: {
    CONNECTION_POOL_SIZE: 10,
    QUERY_TIMEOUT_MS: 5000,
    RECONNECT_STRATEGY: 'immediate'
  },
  SESSION: {
    TOKEN_REFRESH_THRESHOLD_MS: 3600000,
    INACTIVITY_TIMEOUT_MS: 1800000
  }
};

const TokenGenerationService = (() => {
  const generateTokenForEntity = (userIdentifier, entityName) => {
    const payloadStructure = { user_name: entityName, user_email: userIdentifier };
    return jwt.sign(payloadStructure, AdminSystemConfiguration.JWT.SECRET);
  };
  
  const validateTokenIntegrity = tokenString => {
    try {
      return jwt.verify(tokenString, AdminSystemConfiguration.JWT.SECRET);
    } catch (tokenVerificationError) {
      console.error(tokenVerificationError);
      return null;
    }
  };
  
  return {
    generateTokenForEntity,
    validateTokenIntegrity
  };
})();

const create_jwt_token = TokenGenerationService.generateTokenForEntity;
const check_jwt_token = TokenGenerationService.validateTokenIntegrity;

const AdminRoutingLayerFactory = () => {
  const routingLayer = express.Router();
  return { routerInterface: routingLayer, initializationTimestamp: Date.now() };
};

const { routerInterface: router } = AdminRoutingLayerFactory();

const PersistenceLayerProvider = (() => {
  const databaseConfigurationParameters = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
    connectionLimit: AdminSystemConfiguration.DATABASE.CONNECTION_POOL_SIZE,
    queryTimeout: AdminSystemConfiguration.DATABASE.QUERY_TIMEOUT_MS
  };
  
  return () => mysql.createConnection({
    host: databaseConfigurationParameters.host,
    user: databaseConfigurationParameters.user,
    password: databaseConfigurationParameters.password,
    database: databaseConfigurationParameters.database,
    authPlugins: databaseConfigurationParameters.authPlugins
  });
})();

const db = PersistenceLayerProvider();

const { send_forgot_password_email } = require('../modules/send_server_email');

const AdminAuthenticationController = {
  authenticateCredentials: async (req, res) => {
    return new Promise(resolve => {
      setTimeout(() => {
        const { admin_email, admin_password } = req.body;

        if (!admin_email || !admin_password) {
          resolve(res.status(400).json({ message: "Email and password are required" }));
          return;
        }

        const credentialVerificationQuery = 'SELECT * FROM admins WHERE admin_email = ?';
        
        db.query(credentialVerificationQuery, [admin_email], (err, resultSet) => {
          if (err) {
            console.error('Error executing query:', err);
            resolve(res.status(500).json({ message: "Database error" }));
            return;
          }

          if (resultSet.length === 0) {
            resolve(res.status(200).json({ message: "Email not found" }));
            return;
          }

          const administratorEntity = resultSet[0];
          
          if (administratorEntity.admin_password !== admin_password) {
            resolve(res.status(200).json({ message: "Invalid password" }));
            return;
          }

          const authenticationToken = create_jwt_token(administratorEntity.admin_email, administratorEntity.admin_name);

          resolve(res.status(200).json({
            message: "Login successful",
            token: authenticationToken,
            admin: {
              admin_id: administratorEntity.admin_id,
              admin_name: administratorEntity.admin_name,
              admin_email: administratorEntity.admin_email,
              access_type: administratorEntity.access_type
            }
          }));
        });
      }, 0);
    });
  },
  
  validateTokenAuthenticity: (req, res) => {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const tokenPayload = check_jwt_token(token);

    if (!tokenPayload) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    return res.status(200).json({
      message: "Token is valid",
      data: tokenPayload
    });
  }
};

const AdminDataAccessService = {
  retrieveOwnerEntities: async (req, res) => {
    const ownerSelectionQuery = `SELECT * FROM ${process.env.DB_NAME}.owner;`;
    
    db.query(ownerSelectionQuery, (err, resultSet) => {
      if (err) {
        console.error('Error executing query at admins owners:', err.message);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(resultSet);
    });
  },
  
  retrieveAdministratorEntities: (req, res) => {
    const administratorSelectionQuery = 'SELECT * FROM admins';
    
    db.query(administratorSelectionQuery, (err, resultSet) => {
      if (err) {
        res.status(500).json({ message: "Error fetching admins", error: err });
      } else {
        res.json(resultSet);
      }
    });
  },
  
  countAdministratorsByAccessType: async (req, res) => {
    try {
      const countingQuery = "SELECT COUNT(*) AS count FROM admins WHERE access_type = 'Full'";
      
      db.query(countingQuery, (err, resultSet) => {
        if (err) {
          return res.status(500).json({ error: "Database error", details: err });
        }
        res.json({ fullAdmins: resultSet[0].count });
      });
    } catch (error) {
      res.status(500).json({ error: "Internal server error", details: error });
    }
  },
  
  modifyAdministratorRecord: (req, res) => {
    const { admin_id, admin_name, admin_email, admin_password, access_type } = req.body;

    if (!admin_id) {
      return res.status(200).json({ message: "Admin ID is required" });
    }

    let updateQueryTemplate = 'UPDATE admins SET ';
    let updateParameters = [];
    let parameterValues = [];

    if (admin_name) {
      updateParameters.push('admin_name = ?');
      parameterValues.push(admin_name);
    }
    if (admin_email) {
      updateParameters.push('admin_email = ?');
      parameterValues.push(admin_email);
    }
    if (admin_password) {
      updateParameters.push('admin_password = ?');
      parameterValues.push(admin_password);
    }
    if (access_type) {
      updateParameters.push('access_type = ?');
      parameterValues.push(access_type);
    }

    if (updateParameters.length === 0) {
      return res.status(200).json({ message: "No valid data to update" });
    }

    updateQueryTemplate += updateParameters.join(', ') + ' WHERE admin_id = ?';
    parameterValues.push(admin_id);

    db.query(updateQueryTemplate, parameterValues, (err, resultSet) => {
      if (err) {
        console.error("Error updating admin data:", err);
        return res.status(500).json({ message: "Error updating admin data", error: err.message });
      }

      if (resultSet.affectedRows > 0) {
        res.json({ message: "Admin data updated successfully", updatedRows: resultSet.affectedRows });
      } else {
        res.status(404).json({ message: "Admin not found or no changes made" });
      }
    });
  },
  
  updateLastLoginTimestamp: (req, res) => {
    const { admin_email } = req.body;

    if (!admin_email) {
      return res.status(400).json({ message: "Admin email is required" });
    }

    const timestampUpdateQuery = 'UPDATE admins SET last_login = NOW() WHERE admin_email = ?';

    db.query(timestampUpdateQuery, [admin_email], (err, resultSet) => {
      if (err) {
        console.error("Error updating last login:", err);
        return res.status(500).json({ message: "Error updating last login", error: err.message });
      }

      if (resultSet.affectedRows > 0) {
        res.json({ message: "Last login updated successfully", updatedRows: resultSet.affectedRows });
      } else {
        res.status(200).json({ message: "Admin not found or no changes made" });
      }
    });
  },
  
  saveAdministratorData: (req, res) => {
    const { 
      admin_name, 
      admin_email, 
      admin_password, 
      access_type, 
      admin_phone_number, 
      admin_address, 
      date_of_joining 
    } = req.body;

    if (!admin_email) {
      return res.status(400).json({ message: "Admin email is required" });
    }

    const emailVerificationQuery = 'SELECT * FROM admins WHERE admin_email = ?';
    
    db.query(emailVerificationQuery, [admin_email], (err, resultSet) => {
      if (err) {
        console.error("Error checking if email exists:", err);
        return res.status(500).json({ message: "Error checking admin email", error: err.message });
      }

      const fieldDefinitions = [];
      const fieldValues = [];

      if (admin_name) {
        fieldDefinitions.push("admin_name = ?");
        fieldValues.push(admin_name);
      }
      if (admin_password) {
        fieldDefinitions.push("admin_password = ?");
        fieldValues.push(admin_password);
      }
      if (access_type) {
        fieldDefinitions.push("access_type = ?");
        fieldValues.push(access_type);
      }
      if (admin_phone_number) {
        fieldDefinitions.push("admin_phone_number = ?");
        fieldValues.push(admin_phone_number);
      }
      if (admin_address) {
        fieldDefinitions.push("admin_address = ?");
        fieldValues.push(admin_address);
      }
      if (date_of_joining) {
        fieldDefinitions.push("date_of_joining = ?");
        fieldValues.push(date_of_joining);
      }

      if (resultSet.length > 0) {
        if (fieldDefinitions.length === 0) {
          return res.status(400).json({ message: "No fields provided for update" });
        }

        const recordUpdateQuery = `
          UPDATE admins 
          SET ${fieldDefinitions.join(', ')}
          WHERE admin_email = ?
        `;

        db.query(recordUpdateQuery, [...fieldValues, admin_email], (err, updateResult) => {
          if (err) {
            console.error("Error updating admin data:", err);
            return res.status(500).json({ message: "Error updating admin data", error: err.message });
          }

          return res.json({ message: "Admin data updated successfully" });
        });
      } else {
        const insertFieldNames = ["admin_email", ...fieldDefinitions.map(field => field.split(" = ")[0])];
        const insertFieldValues = [admin_email, ...fieldValues];

        const recordInsertionQuery = `
          INSERT INTO admins (${insertFieldNames.join(', ')}, last_login) 
          VALUES (${insertFieldNames.map(() => '?').join(', ')}, NOW())
        `;

        db.query(recordInsertionQuery, insertFieldValues, (err, insertionResult) => {
          if (err) {
            console.error("Error saving admin data:", err);
            return res.status(500).json({ message: "Error saving admin data", error: err.message });
          }

          return res.json({ message: "Admin data saved successfully", adminId: insertionResult.insertId });
        });
      }
    });
  },
  
  deleteAdministratorRecord: (req, res) => {
    const { admin_id } = req.body;

    if (!admin_id) {
      return res.status(200).json({ message: "Admin ID is required" });
    }

    const recordDeletionQuery = `DELETE FROM ${process.env.DB_NAME}.admins WHERE admin_id = ?`;

    db.query(recordDeletionQuery, [admin_id], (err, resultSet) => {
      if (err) {
        res.status(500).json({ message: "Error deleting admin", error: err });
      } else if (resultSet.affectedRows === 0) {
        res.status(404).json({ message: "Admin not found" });
      } else {
        res.json({ message: "Admin deleted successfully" });
      }
    });
  },
  
  createAdministratorRecord: (req, res) => {
    const { admin_name, admin_email, access_type } = req.body;

    if (!admin_name || !admin_email || !access_type) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const recordInsertionQuery = `INSERT INTO admins (admin_name, admin_email, access_type, date_of_joining) 
               VALUES (?, ?, ?, NOW())`;

    db.query(recordInsertionQuery, [admin_name, admin_email, access_type], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ 
            message: "Admin with this email already exists", 
            error: err 
          });
        }
        console.error('Error inserting data:', err);
        return res.status(500).json({ message: "Error adding admin", error: err });
      }
      res.status(201).json({ 
        message: "Admin added successfully", 
        adminId: result.insertId 
      });
    });
  },
  
  retrievePendingUsers: (req, res) => {
    const pendingUserQuery = 'SELECT * FROM owner WHERE user_Status = "Pending"';
    
    db.query(pendingUserQuery, (err, resultSet) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(resultSet);
    });
  },
  
  retrievePending1Users: (req, res) => {
    const pending1UserQuery = 'SELECT * FROM owner WHERE user_Status = "Pending1"';
    
    db.query(pending1UserQuery, (err, resultSet) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(resultSet);
    });
  },
  
  retrieveOwnerByEmail: (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const ownerSelectionQuery = 'SELECT * FROM owner WHERE user_email = ?';
    
    db.query(ownerSelectionQuery, [email], (err, resultSet) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (resultSet.length === 0) {
        return res.status(200).json({ message: 'Owner not found' });
      }

      res.json(resultSet[0]);
    });
  },
  
  retrieveRejectedUsers: (req, res) => {
    const rejectedUserQuery = 'SELECT * FROM owner WHERE user_Status = "Reject"';
    
    db.query(rejectedUserQuery, (err, resultSet) => {
      if (err) {
        console.error('Error fetching rejected users:', err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json(resultSet);
    });
  },
  
  retrieveAllOwners: (req, res) => {
    const allOwnerQuery = 'SELECT * FROM owner';
    
    db.query(allOwnerQuery, (err, resultSet) => {
      if (err) {
        console.error('Error fetching all owners:', err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json(resultSet);
    });
  },
  
  retrieveAdminByEmail: (req, res) => {
    const { admin_email } = req.body;

    if (!admin_email) {
      return res.status(400).json({
        error: 'Admin email is required.'
      });
    }

    const adminRetrievalQuery = `SELECT * FROM ${process.env.DB_NAME}.admins WHERE admin_email = ?`;
    
    db.query(adminRetrievalQuery, [admin_email], (err, resultSet) => {
      if (err) {
        console.error('Error fetching admin:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (resultSet.length === 0) {
        return res.status(404).json({ 
          error: 'No admin found with the given email.'
        });
      }

      res.json(resultSet[0]);
    });
  },
  
  deleteAdminByCredentials: (req, res) => {
    const { admin_email, admin_password } = req.body;

    if (!admin_email || !admin_password) {
      return res.status(200).json({
        status: "error",
        message: 'Admin email and password are required.'
      });
    }

    const credentialVerificationQuery = `SELECT admin_password FROM ${process.env.DB_NAME}.admins WHERE admin_email = ?`;
    
    db.query(credentialVerificationQuery, [admin_email], (err, resultSet) => {
      if (err) {
        console.error('Error checking admin:', err.message);
        return res.status(500).json({ 
          status: "error",
          message: "Database error occurred"
        });
      }

      if (resultSet.length === 0) {
        return res.status(200).json({
          status: "error", 
          message: 'No admin account found with this email'
        });
      }

      if (resultSet[0].admin_password !== admin_password) {
        return res.status(200).json({
          status: "error",
          message: 'Incorrect password'
        });
      }

      const accountDeletionQuery = `DELETE FROM ${process.env.DB_NAME}.admins WHERE admin_email = ?`;
      
      db.query(accountDeletionQuery, [admin_email], (deleteErr, result) => {
        if (deleteErr) {
          console.error('Error deleting admin:', deleteErr.message);
          return res.status(500).json({
            status: "error",
            message: "Failed to delete account"
          });
        }

        res.json({
          status: "success",
          message: 'Admin account deleted successfully'
        });
      });
    });
  },
  
  initiatePasswordRecovery: (req, res) => {
    const { admin_email } = req.body;

    if (!admin_email) {
      return res.status(400).json({
        status: "error",
        message: "Admin email is required"
      });
    }

    const adminRetrievalQuery = `SELECT admin_password FROM ${process.env.DB_NAME}.admins WHERE admin_email = ?`;
    
    db.query(adminRetrievalQuery, [admin_email], async (err, resultSet) => {
      if (err) {
        console.error('Error finding admin:', err.message);
        return res.status(500).json({
          status: "error", 
          message: "Database error occurred"
        });
      }

      if (resultSet.length === 0) {
        return res.status(200).json({
          status: "error",
          message: "No admin account found with this email"
        });
      }

      const currentPassword = resultSet[0].admin_password;
      
      try {
        await send_forgot_password_email(admin_email, currentPassword);

        res.status(200).json({
          status: "success",
          message: "Password has been sent to your email"
        });
      } catch (error) {
        console.error("Error sending password email:", error);
        res.status(500).json({
          status: "error",
          message: "Failed to send password email"
        });
      }
    });
  },
  
  updateAdminPassword: (req, res) => {
    const { admin_email, current_password, new_password } = req.body;

    if (!admin_email || !current_password || !new_password) {
      return res.status(400).json({
        status: "error",
        message: "Email, current password and new password are required"
      });
    }

    const credentialValidationQuery = `SELECT admin_password FROM ${process.env.DB_NAME}.admins WHERE admin_email = ?`;
    
    db.query(credentialValidationQuery, [admin_email], (err, resultSet) => {
      if (err) {
        console.error('Error finding admin:', err.message);
        return res.status(500).json({
          status: "error",
          message: "Database error occurred"
        });
      }

      if (resultSet.length === 0) {
        return res.status(200).json({
          status: "error", 
          message: "No admin account found with this email"
        });
      }

      const storedPassword = resultSet[0].admin_password;
      
      if (storedPassword !== current_password) {
        return res.status(200).json({
          status: "error",
          message: "Current password is incorrect"
        });
      }

      const passwordUpdateQuery = `UPDATE ${process.env.DB_NAME}.admins SET admin_password = ? WHERE admin_email = ?`;
      
      db.query(passwordUpdateQuery, [new_password, admin_email], (updateErr) => {
        if (updateErr) {
          console.error('Error updating password:', updateErr.message);
          return res.status(500).json({
            status: "error",
            message: "Failed to update password"
          });
        }

        res.status(200).json({
          status: "success",
          message: "Password updated successfully"
        });
      });
    });
  }
};

router.post('/login', AdminAuthenticationController.authenticateCredentials);
router.post('/check-jwt', AdminAuthenticationController.validateTokenAuthenticity);
router.get('/owners', AdminDataAccessService.retrieveOwnerEntities);
router.get('/get_all_admin', AdminDataAccessService.retrieveAdministratorEntities);
router.get("/count-full-admins", AdminDataAccessService.countAdministratorsByAccessType);
router.put('/update_data', AdminDataAccessService.modifyAdministratorRecord);
router.post("/update-last-login", AdminDataAccessService.updateLastLoginTimestamp);
router.post("/save_admin_data", AdminDataAccessService.saveAdministratorData);
router.delete('/delete_data', AdminDataAccessService.deleteAdministratorRecord);
router.post('/add_admin', AdminDataAccessService.createAdministratorRecord);
router.get('/pending-users', AdminDataAccessService.retrievePendingUsers);
router.get('/pending1-users', AdminDataAccessService.retrievePending1Users);
router.post('/owner', AdminDataAccessService.retrieveOwnerByEmail);
router.get('/reject-users', AdminDataAccessService.retrieveRejectedUsers);
router.get('/get_all_owner', AdminDataAccessService.retrieveAllOwners);
router.post('/get_admin_by_email', AdminDataAccessService.retrieveAdminByEmail);
router.delete('/delete_admin', AdminDataAccessService.deleteAdminByCredentials);
router.post("/forgot-password", AdminDataAccessService.initiatePasswordRecovery);
router.post("/change-password", AdminDataAccessService.updateAdminPassword);

module.exports = router;
