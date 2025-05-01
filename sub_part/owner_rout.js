const express = require("express");
const mysql = require("mysql2");
const fs = require('fs');
const path = require('path');
// const { io } = require("../server");

// Define root directory for file storage
const rootDirectory = path.join(__dirname, "..", "root");
// Create root directory if it doesn't exist
if (!fs.existsSync(rootDirectory)) {
  fs.mkdirSync(rootDirectory, { recursive: true });
}

const router = express.Router();
const jwt = require("jsonwebtoken");

const {
  server_request_mode,
  write_log_file,
  error_message,
  info_message,
  success_message,
  normal_message,
} = require("./../modules/_all_help");
const {
  generate_otp,
  get_otp,
  clear_otp,
} = require("./../modules/OTP_generate");
const { route } = require("./shrey_11");
const JWT_SECRET_KEY = "Jwt_key_for_photography_website";
require('dotenv').config();
function create_jwt_token(user_email, user_name) {
  let data_for_jwt = { user_name, user_email };
  let jwt_token = jwt.sign(data_for_jwt, JWT_SECRET_KEY);
  return jwt_token;
}


const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {},
});
router.post("/add_owner", (req, res) => {
  const {
    user_name,
    user_email,
    user_password,
    business_name,
    business_address,
    mobile_number,
    GST_number,
  } = req.body;

  const checkEmailQuery = "SELECT * FROM owner WHERE user_email = ?";
  const checkUserQuery = "SELECT * FROM owner WHERE user_name = ?";

  db.query(checkEmailQuery, [user_email], (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "Database error" });
    } else if (result.length > 0) {
      return res.status(200).json({ error: "Email already exists" });
    }
    db.query(checkUserQuery, [user_name], (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: "Database error" });
      } else if (result.length > 0) {
        return res.status(200).json({ error: "user name already exists" });
      }

      return res.status(200).json({ message: "go for otp" });
    });
  });
});

router.post("/login", (req, res) => {
  const { user_email, user_password } = req.body;

  if (!user_email || !user_password) {
    return res.status(200).json({ error: "Email and password are required" });
  }

  const query =
    `SELECT * FROM ${process.env.DB_NAME}.owner WHERE user_email = ? AND user_password = ?`;

  db.query(query, [user_email, user_password], (err, results) => {
    if (err) {
      console.error("Database error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (results.length > 0) {
      const user_name = results[0].user_name;
      const token = create_jwt_token(user_email, user_name);
      return res.status(200).json({
        message: "Login successful",
        user: results[0],
        user_key: token,
      });
    } else {
      return res
        .status(200)
        .json({ error: "Invalid email or password", status: "login-fail" });
    }
  });
});

router.delete("/delete-by-email", (req, res) => {
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const query = `DELETE FROM ${process.env.DB_NAME}.owner WHERE user_email = ?`;

  db.query(query, [user_email], (err, result) => {
    if (err) {
      console.error("Database error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "No user found with this email" });
    }

    res.status(200).json({ message: "User deleted successfully" });
  });
});

function getNotifications(
  notification_type,
  notification_message,
  notification_title,
  callback
) {
  const query = `
    INSERT INTO notification (notification_type, notification_message, notification_title, created_at) 
    VALUES (?, ?, ?, NOW())`;

  // Execute the query with placeholders for security
  db.query(
    query,
    [notification_type, notification_message, notification_title],
    (err, results) => {
      if (err) {
        console.error("Error executing query:", err);
        return callback(err, null);
      }
      callback(null, results);
    }
  );
}

router.post("/verify_otp_owner", async (req, res) => {
  const {
    type,
    user_send_otp,
    user_name,
    user_email,
    user_password,
    business_name,
    business_address,
    mobile_number,
    GST_number,
  } = req.body;

  if (!user_email || !user_send_otp || !type) {
    error_message("verify_otp say : Email and OTP are required");
    return res.status(400).json({ error: "Email and OTP are required" });
  }
  try {
    let storedOtp;
    if (type == "owner") {
      storedOtp = get_otp(user_email, "owner");
    } else {
      storedOtp = get_otp(user_email, "client");
    }
    if (storedOtp && storedOtp === user_send_otp) {
      const insertQuery =
        "INSERT INTO owner (user_name, user_email, user_password, business_name, business_address, mobile_number, GST_number) VALUES ( ?, ?, ?, ?, ?, ?, ?)";
      db.query(
        insertQuery,
        [
          user_name,
          user_email,
          user_password,
          business_name,
          business_address,
          mobile_number,
          GST_number,
        ],
        (err, result) => {
          if (err) {
            console.log(err);
            return res.status(500).json({ error: "Database error" });
          }
          let token = create_jwt_token(user_email, user_name);

          try {
            const baseDir = path.join(__dirname, "..", "root");

            // Step 1: Create 'root' folder if not exists
            if (!fs.existsSync(baseDir)) {
              fs.mkdirSync(baseDir);
              console.log("Created root folder");
            }

            // Step 2: Create user folder
            const userDir = path.join(baseDir, user_email);
            if (!fs.existsSync(userDir)) {
              fs.mkdirSync(userDir);
              console.log("Created user folder:", user_email);
            }

            // Step 3: Create 'drive' folder inside user
            const driveDir = path.join(userDir, "drive");
            const portfolioFoldersDir = path.join(driveDir, "portfolio", "folders");
            fs.mkdirSync(portfolioFoldersDir, { recursive: true });

            console.log("Created 'drive/portfolio/folders' structure");

            // ✅ Note: No user_profile or business_profile folders now
            // Those will be uploaded later as files:
            //   path.join(userDir, "user_profile.jpg") or ".png"
            //   path.join(userDir, "business_profile.jpg") or ".png"

          } catch (folderErr) {
            console.error("Failed to create folders:", folderErr);
            return res.status(500).json({ error: "Failed to create user folders" });
          }


          // end of the create folder structure code 


          getNotifications(
            "padding_owner",
            `new request on ${user_email}`,
            "padding request",
            (err, results) => {
              if (err) {
                return res
                  .status(500)
                  .json({ error: "Failed to fetch notifications" });
              }
              console.log("all set at notification");
              res.status(200).json({
                message: "OTP verified successfully",
                user_key: token,
              });
            }
          );
        }
      );
    } else {
      res.status(200).json({ error: "Invalid OTP" });
    }
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "Failed to verify OTP" });
  }
});

router.post("/reset_password_verify_otp", async (req, res) => {
  const body_otp = req.body.user_send_otp;
  const user_email = req.body.user_email;
  if (body_otp === get_otp(user_email, "owner")) {
    return res
      .status(200)
      .json({ message: "user pass with OTP", status: "verify-pass" });
  } else {
    return res
      .status(200)
      .json({ message: "OTP does not match", status: "verify-fail" });
  }
});

router.post("/set_new_password", (req, res) => {
  const { email, new_password } = req.body;

  if (!email || !new_password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  //1 --
  const findUserQuery = `SELECT user_name FROM owner WHERE user_email = ?`;

  db.query(findUserQuery, [email], (err, result) => {
    if (err) {
      console.error("Database error while finding user:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (result.length === 0) {
      return res
        .status(404)
        .json({ message: "User not found", status: "user-not-found" });
    }

    const user_name = result[0].user_name;

    //2 --
    const updateQuery = `UPDATE owner SET user_password = ? WHERE user_email = ?`;

    db.query(updateQuery, [new_password, email], (updateErr, updateResult) => {
      if (updateErr) {
        console.error("Database error while updating password:", updateErr);
        return res.status(500).json({ error: "Database error" });
      }

      if (updateResult.affectedRows === 0) {
        return res
          .status(404)
          .json({ message: "User not found", status: "user-not-found" });
      }

      //  3 /--
      const token = create_jwt_token(email, user_name);
      info_message(`Email ${email} has updated their password`);

      // Send the response
      res.status(200).json({
        message: "Password updated successfully",
        status: "password-updated",
        user_key: token,
      });
    });
  });
});

// profile part 2-------------

router.get("/get-all-owners", (req, res) => {
  const query = `
  SELECT 
    user_name,
    user_email, 
    business_name,
    business_address,
    mobile_number,
    gst_number,
    user_Status,
    set_status_by_admin
  FROM owner
`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching owners:", err);
      return res
        .status(500)
        .json({ error: "An error occurred while fetching owners." });
    }

    res.status(200).json(results);
  });
});

router.post("/get-owners", (req, res) => {
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: "Email is required" });
  }

  // Corrected SQL query without trailing comma
  const query = `
    SELECT 
      *
    FROM owner 
    WHERE user_email = ?
  `;

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching owner data:", err);
      return res
        .status(500)
        .json({ error: "An error occurred while fetching owner data." });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No owner found with this email" });
    }

    res.status(200).json({ owners: results[0] });
  });
});

router.put("/update-owner", (req, res) => {
  const email = req.body.user_email; // Find by this email

  if (!email) {
    return res
      .status(400)
      .json({ error: "Email is required to update the record." });
  }

  // Initialize an empty object for the data to be updated
  const updateData = {};

  // Only add fields to updateData if they are provided in the request body
  if (req.body.client_id) updateData.client_id = req.body.client_id;
  if (req.body.user_name) updateData.user_name = req.body.user_name;
  if (req.body.user_email) updateData.user_email = req.body.user_email;
  if (req.body.user_password) updateData.user_password = req.body.user_password;
  if (req.body.business_name) updateData.business_name = req.body.business_name;
  if (req.body.business_address)
    updateData.business_address = req.body.business_address;
  if (req.body.mobile_number) updateData.mobile_number = req.body.mobile_number;
  if (req.body.gst_number) updateData.gst_number = req.body.gst_number;
  if (req.body.user_Status) updateData.user_Status = req.body.user_Status;
  if (req.body.admin_message) updateData.admin_message = req.body.admin_message;
  if (req.body.set_status_by_admin)
    updateData.set_status_by_admin = req.body.set_status_by_admin;

  // Check if there is any data to update
  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "No data provided to update." });
  }

  const query = "UPDATE owner SET ? WHERE user_email = ?";

  db.query(query, [updateData, email], (err, result) => {
    if (err) {
      console.error("Error updating data:", err);
      return res
        .status(500)
        .json({ error: "An error occurred while updating the record." });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "No user found with the provided email." });
    }

    res.status(200).json({ message: "Record updated successfully.", result });
  });
});

router.post("/update-status", async (req, res) => {
  const { user_email, user_Status, message, set_status_by_admin } = req.body;

  // Validate required fields
  if (!user_email || !user_Status) {
    return res
      .status(400)
      .json({ message: "Missing required fields: user_email or user_Status" });
  }

  // Set default values for optional fields if they're undefined
  const safeMessage = message || null; // If message is undefined, set it as null
  const safeAdminEmail = set_status_by_admin || null; // If admin email is undefined, set it as null

  // Retrieve admin information if an admin email is provided
  if (safeAdminEmail) {
    const getAdminIdQuery = "SELECT admin_id FROM admins WHERE admin_email = ?";
    db.execute(getAdminIdQuery, [safeAdminEmail], async (err, adminResult) => {
      if (err) {
        console.log(err);
        return res
          .status(500)
          .json({ message: "Database error when fetching admin" });
      }

      if (adminResult.length === 0) {
        return res.status(400).json({ message: "Admin not found" });
      }


      // Update the user's status in the 'users' table
      const updateStatusQuery = `
        UPDATE owner
        SET user_Status = ?, admin_message = ?, set_status_by_admin = ?
        WHERE user_email = ?
      `;

      db.execute(
        updateStatusQuery,
        [user_Status, safeMessage, safeAdminEmail, user_email],
        (err, result) => {
          if (user_Status == "Accept") {
            req.io.emit(`user_status_updated_${user_email}`, { user_email, user_Status });
          }
          if (err) {
            console.log(err);
            return res
              .status(500)
              .json({ message: "Database error while updating user status" });
          }

          return res.json({ message: "Status updated" });
        }
      );
    });
  } else {
    // If no admin email is provided, update the status without an admin_id
    const updateStatusQuery = `
      UPDATE owner
      SET user_Status = ?, admin_message = ?, set_status_by_admin = NULL
      WHERE user_email = ?
    `;
    db.execute(
      updateStatusQuery,
      [user_Status, safeMessage, user_email],
      (err, result) => {
        if (err) {
          console.log(err);
          return res
            .status(500)
            .json({ message: "Database error while updating user status" });
        }

        return res.json({ message: "Status updated" });
      }
    );
  }
});

router.post("/update-owner", (req, res) => {
  const { user_email, user_name, first_name, last_name, gender, social_media, business_address } =
    req.body;

  const query = `UPDATE owner SET user_name = ?, first_name = ?, last_name = ?, gender = ?, social_media = ?, business_address = ? WHERE user_email = ?`;
  db.query(
    query,
    [user_name, first_name, last_name, gender, social_media, business_address, user_email],
    (err, result) => {
      if (err) {
        console.error("Error updating owner:", err);
        return res
          .status(500)
          .json({ error: "An error occurred while updating the owner." });
      }
      res.status(200).json({ message: "Owner updated successfully." });
    }
  );
});

router.delete("/delete-owner", (req, res) => {
  const { user_email } = req.body;
  const query = "DELETE FROM owner WHERE user_email = ?";
  db.query(query, [user_email], (err, result) => {
    if (err) {
      console.error("Error deleting owner:", err);
      return res
        .status(500)
        .json({ error: "An error occurred while deleting the owner." });
    }
    res.status(200).json({ message: "Account deleted successfully." });
  });
});


router.post("/update-business", (req, res) => {
  const {
    business_name,
    business_email,
    gst_number,
    business_address,
    user_email,
  } = req.body;

  if (
    !business_name ||
    !business_email ||
    !business_address ||
    !user_email
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const query = `
    UPDATE owner
    SET business_name = ?, business_email = ?, gst_number = ?, business_address = ?
    WHERE user_email = ?
  `;

  db.query(
    query,
    [business_name, business_email, gst_number, business_address, user_email],
    (err, result) => {
      if (err) {
        console.error("Error updating business data:", err);
        return res.status(500).json({ error: "Error updating business data" });
      }

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ error: "Business not found or no changes made" });
      }

      res.status(200).json({ message: "Business updated successfully" });
    }
  );
});

router.post("/add-equipment", (req, res) => {
  const equipmentItems = req.body;

  if (!Array.isArray(equipmentItems)) {
    return res
      .status(400)
      .json({ message: "Expected an array of equipment items" });
  }

  const query = `
    INSERT INTO equipment (user_email, name, equipment_company, equipment_type, equipment_description, equipment_price_per_day)
    VALUES (?, ?, ?, ?, ?, ?)`;

  equipmentItems.forEach((item) => {
    const {
      user_email,
      name,
      equipment_company,
      equipment_type,
      equipment_description,
      equipment_price_per_day,
    } = item;

    db.query(
      query,
      [
        user_email,
        name,
        equipment_company,
        equipment_type,
        equipment_description,
        equipment_price_per_day,
      ],
      (err, result) => {
        if (err) {
          console.error("Error adding equipment:", err);
          return res.status(500).json({ message: "Error adding equipment" });
        }
      }
    );
  });

  res.status(200).json({ message: "Equipment added successfully" });
});

router.post("/equipment", (req, res) => {
  const { user_email } = req.body;

  const query = "SELECT * FROM equipment WHERE user_email = ?";

  db.query(query, [user_email], (err, result) => {
    if (err) {
      console.error("Error fetching equipment:", err);
      return res.status(500).json({ message: "Error fetching equipment" });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "No equipment found" });
    }

    res.status(200).json(result);
  });
});

router.post("/remove-equipment", (req, res) => {
  const { user_email, user_equipment_id } = req.body;

  if (!user_email || !user_equipment_id) {
    console.log(
      "missing user_email or equipment_id",
      user_email,
      user_equipment_id
    );
    return res
      .status(400)
      .json({ message: "Missing user_email or equipment_id" });
  }

  const query =
    "DELETE FROM equipment WHERE user_email = ? AND user_equipment_id = ?";

  db.query(query, [user_email, user_equipment_id], (err, result) => {
    if (err) {
      console.error("Error removing equipment:", err);
      return res.status(500).json({ message: "Error removing equipment" });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "No matching equipment found for removal" });
    }

    res.status(200).json({ message: "Equipment removed successfully" });
  });
});

router.post("/edit-equipment", (req, res) => {
  const {
    user_email,
    user_equipment_id,
    name,
    equipment_company,
    equipment_type,
    equipment_description,
    equipment_price_per_day,
  } = req.body;

  // Validate required fields
  if (
    !user_email ||
    !user_equipment_id ||
    !name ||
    !equipment_company ||
    !equipment_type ||
    !equipment_price_per_day
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const query = `
    UPDATE equipment 
    SET name = ?, equipment_company = ?, equipment_type = ?, 
        equipment_description = ?, equipment_price_per_day = ?
    WHERE user_email = ? AND user_equipment_id = ?`;

  db.query(
    query,
    [
      name,
      equipment_company,
      equipment_type,
      equipment_description,
      equipment_price_per_day,
      user_email,
      user_equipment_id,
    ],
    (err, result) => {
      if (err) {
        console.error("Error updating equipment:", err);
        return res.status(500).json({ message: "Error updating equipment" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Equipment not found or you don't have permission to edit it" });
      }

      res.status(200).json({
        message: "Equipment updated successfully"
      });
    }
  );
});

router.post("/add-one-equipment", (req, res) => {
  const {
    user_email,
    user_equipment_id,
    name,
    equipment_company,
    equipment_type,
    equipment_description,
    equipment_price_per_day,
  } = req.body;

  // Validate required fields
  if (
    !user_email ||
    !user_equipment_id ||
    !name ||
    !equipment_company ||
    !equipment_type ||
    !equipment_price_per_day
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const query = `
    INSERT INTO equipment (user_email, user_equipment_id, name, equipment_company, equipment_type, equipment_description, equipment_price_per_day)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    query,
    [
      user_email,
      user_equipment_id,
      name,
      equipment_company,
      equipment_type,
      equipment_description,
      equipment_price_per_day,
    ],
    (err, result) => {
      if (err) {
        console.error("Error adding equipment:", err);
        return res.status(500).json({ message: "Error adding equipment" });
      }
      res.status(200).json({
        message: "Equipment added successfully",
        equipmentId: result.insertId,
      });
    }
  );
});

router.post("/get-name", (req, res) => {
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const query = "SELECT user_name FROM owner WHERE user_email = ?";

  db.query(query, [user_email], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Database error", details: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const { user_name } = results[0];
    res.json({ user_name: `${user_name}` });
  });
});


router.get("/search", (req, res) => {
  const searchTerm = req.query.term;

  const ownerQuery = `
    SELECT * FROM owner 
    WHERE user_name LIKE CONCAT(?, '%') 
    OR user_email LIKE CONCAT(?, '%') 
    OR business_name LIKE CONCAT(?, '%')
    OR business_address LIKE CONCAT(?, '%');
  `;

  const equipmentQuery = `
    SELECT * FROM equipment
    WHERE name LIKE CONCAT(?, '%')

  `;

  const packageQuery = `
    SELECT * FROM packages
    WHERE package_name LIKE CONCAT(?, '%')
    
  `;

  db.query(
    ownerQuery,
    [searchTerm, searchTerm, searchTerm, searchTerm],
    (err, ownerResults) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.query(
        equipmentQuery,
        [searchTerm, searchTerm],
        (err, equipmentResults) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.query(
            packageQuery,
            [searchTerm, searchTerm],
            (err, packageResults) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              // Send back all search results in a structured format
              res.json({
                owners: ownerResults,
                equipment: equipmentResults,
                packages: packageResults,
              });
            }
          );
        }
      );
    }
  );
});

// Add photos to a folder - Modified to store Google Drive file IDs
router.post("/portfolio/add-photos", (req, res) => {
  const { folder_id, user_email, photos } = req.body;

  if (!folder_id || !user_email || !Array.isArray(photos)) {
    return res.status(400).json({ error: "Invalid request data" });
  }

  // Expecting photos array with format: [{ name: 'photo1.jpg', file_id: 'google_drive_file_id' }]
  const query = `
    INSERT INTO portfolio_photos (folder_id, user_email, photo_name, photo_path, created_at)
    VALUES (?, ?, ?, ?, NOW())
  `;

  const insertPromises = photos.map((photo) => {
    return new Promise((resolve, reject) => {
      // Store the Google Drive file ID in photo_path
      db.query(
        query,
        [folder_id, user_email, photo.name, photo.file_id],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });
  });

  Promise.all(insertPromises)
    .then(() => {
      res.status(201).json({ message: "Photos added successfully" });
    })
    .catch((err) => {
      console.error("Error adding photos:", err);
      res.status(500).json({ error: "Error adding photos" });
    });
});

// Delete specific photos
router.delete("/portfolio/delete-photos", async (req, res) => {
  const { photo_ids, user_email } = req.body;

  if (!Array.isArray(photo_ids) || !user_email) {
    return res
      .status(400)
      .json({ error: "Photo IDs array and user email are required" });
  }

  try {
    // First get the file IDs from Google Drive
    const getFileIdsQuery = `
      SELECT photo_path FROM portfolio_photos 
      WHERE photo_id IN (?) AND user_email = ?
    `;

    const [photos] = await db
      .promise()
      .query(getFileIdsQuery, [photo_ids, user_email]);

    // Delete the photos from database
    const deletePhotosQuery = `
      DELETE FROM portfolio_photos 
      WHERE photo_id IN (?) AND user_email = ?
    `;

    const [result] = await db
      .promise()
      .query(deletePhotosQuery, [photo_ids, user_email]);

    // Here you would add your Google Drive deletion logic
    // const fileIds = photos.map(photo => photo.photo_path);
    // await deleteFilesFromGoogleDrive(fileIds);

    res.status(200).json({
      message: "Photos deleted successfully",
      deletedCount: result.affectedRows,
      deletedFileIds: photos.map((photo) => photo.photo_path),
    });
  } catch (err) {
    console.error("Error deleting photos:", err);
    res.status(500).json({ error: "Error deleting photos" });
  }
});

// // Get all folders for a user
// router.get('/portfolio/folders/:user_email', (req, res) => {
//   const { user_email } = req.params;

//   const query = `
//     SELECT f.*,
//            COUNT(p.photo_id) as photo_count
//     FROM portfolio_folders f
//     LEFT JOIN portfolio_photos p ON f.folder_id = p.folder_id
//     WHERE f.user_email = ?
//     GROUP BY f.folder_id
//     ORDER BY f.created_at DESC
//   `;

//   db.query(query, [user_email], (err, results) => {
//     if (err) {
//       console.error('Error fetching folders:', err);
//       return res.status(500).json({ error: 'Error fetching folders' });
//     }

//     res.status(200).json(results);
//   });
// });

// Get all photos in a folder
router.get("/portfolio/photos/:folder_id", (req, res) => {
  const { folder_id } = req.params;
  const { user_email } = req.query;

  if (!user_email) {
    return res.status(400).json({ error: "User email is required" });
  }

  const query = `
    SELECT 
      photo_id,
      folder_id,
      photo_name,
      photo_path as file_id,
      created_at
    FROM portfolio_photos 
    WHERE folder_id = ? AND user_email = ?
    ORDER BY created_at DESC
  `;

  db.query(query, [folder_id, user_email], (err, results) => {
    if (err) {
      console.error("Error fetching photos:", err);
      return res.status(500).json({ error: "Error fetching photos" });
    }

    res.status(200).json(results);
  });
});

router.post("/update-user-profile-image", (req, res) => {
  const user_email = req.headers['x-user-email'];

  if (!user_email) {
    return res.status(400).send("Missing user email header.");
  }

  try {
    // Create user directory if it doesn't exist
    const baseDir = path.join(__dirname, "..", "root");
    const userDir = path.join(baseDir, user_email);

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir);
    }

    // Generate filename with timestamp to avoid conflicts
    const fileExt = req.headers['content-type']?.split('/')[1] || 'jpeg';
    const filename = `user_profile.${fileExt}`;
    const filepath = path.join(userDir, filename);
    const fileUrlPath = `/root/${user_email}/${filename}`;

    // Create write stream
    const writeStream = fs.createWriteStream(filepath);

    // Pipe request body directly to file
    req.pipe(writeStream);

    // Handle completion and errors
    writeStream.on('finish', () => {
      // Update database with file path instead of base64
      const query = `UPDATE owner SET user_profile_image_base64 = ? WHERE user_email = ?`;
      const values = [fileUrlPath, user_email];

      db.query(query, values, (err, result) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).send("Database error.");
        }

        if (result.affectedRows === 0) {
          return res.status(404).send("Owner not found.");
        }

        res.json({
          message: "User profile image updated successfully.",
          imagePath: fileUrlPath
        });
      });
    });

    writeStream.on('error', (err) => {
      console.error('Error writing file:', err);
      res.status(500).send("Error saving image.");
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).send("Server error.");
  }
});

// Add a new endpoint to serve the images
router.get('/profile-image/:user_email', (req, res) => {
  const { user_email } = req.params;
  const query = `SELECT user_profile_image_base64 FROM owner WHERE user_email = ?`;

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching profile image path:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0 || !results[0].user_profile_image_base64) {
      return res.status(404).send("Image not found");
    }

    const imagePath = results[0].user_profile_image_base64;

    // If it's a URL path (new format)
    if (imagePath.startsWith('/root/')) {
      const fullPath = path.join(__dirname, '..', imagePath);

      if (!fs.existsSync(fullPath)) {
        return res.status(404).send("Image file not found");
      }

      res.sendFile(fullPath);
    }
    // If it's base64 (old format)
    else if (imagePath.startsWith('data:image')) {
      const contentType = imagePath.split(';')[0].split(':')[1];
      res.set('Content-Type', contentType);
      const base64Data = imagePath.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      res.send(buffer);
    }
    else {
      res.status(404).send("Invalid image format");
    }
  });
});

// Remove profile image (user or business)
router.post("/remove-profile-image-type", (req, res) => {
  const { user_email, type } = req.body;

  if (!user_email || !type) {
    return res.status(400).json({ error: "User email and type are required" });
  }

  console.log(`Removing ${type} profile image for user: ${user_email}`);

  // First, get the current image path from the database
  let query;
  let updateQuery;
  let successMessage;

  if (type === 'user') {
    query = "SELECT user_profile_image_base64 FROM owner WHERE user_email = ?";
    updateQuery = "UPDATE owner SET user_profile_image_base64 = NULL WHERE user_email = ?";
    successMessage = "user profile image removed successfully.";
  } else if (type === 'business') {
    query = "SELECT business_profile_base64 FROM owner WHERE user_email = ?";
    updateQuery = "UPDATE owner SET business_profile_base64 = NULL WHERE user_email = ?";
    successMessage = "business profile image removed successfully.";
  } else {
    return res.status(400).json({ error: "Invalid type. Must be 'user' or 'business'" });
  }

  // Get the current image path
  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get the image path
    const imagePath = type === 'user' ? results[0].user_profile_image_base64 : results[0].business_profile_base64;

    // Update database to remove the image path
    db.query(updateQuery, [user_email], (updateErr, updateResult) => {
      if (updateErr) {
        console.error("Database update error:", updateErr);
        return res.status(500).json({ error: "Failed to update database" });
      }

      if (updateResult.affectedRows === 0) {
        return res.status(404).json({ error: "User not found or no image to delete" });
      }

      // If there was an image path and it's not a base64 string, try to delete the file
      if (imagePath && !imagePath.startsWith('data:')) {
        try {
          const fs = require('fs');
          const path = require('path');

          // Try different possible paths for the physical file
          const serverRootDir = path.join(__dirname, '..');
          let filePath = path.join(serverRootDir, imagePath);

          console.log(`Checking for file at: ${filePath}`);
          let fileExists = fs.existsSync(filePath);

          // If not found, try alternative path
          if (!fileExists) {
            // Handle relative path format (/root/user@email/...)
            const altPath = path.join(path.dirname(serverRootDir), "root", imagePath.replace('/root/', ''));
            console.log(`Checking alternative path: ${altPath}`);

            if (fs.existsSync(altPath)) {
              filePath = altPath;
              fileExists = true;
            }
          }

          // If file exists, delete it
          if (fileExists) {
            fs.unlinkSync(filePath);
            console.log(`Deleted physical file: ${filePath}`);
          } else {
            console.warn(`File not found on disk: ${imagePath}`);
          }
        } catch (fileErr) {
          console.error(`Error deleting physical file:`, fileErr);
          // Continue even if file deletion fails
        }
      }

      // Return success response
      res.json({ message: successMessage });
    });
  });
});

// Route to fetch user or business profile image
router.get("/fetch-profile-image", (req, res) => {
  const { user_email, type } = req.query;

  if (!user_email || !type) {
    return res
      .status(400)
      .send("Missing required fields. 'user_email' and 'type' are required.");
  }

  let column;
  if (type === "user") {
    column = "user_profile_image_base64";
  } else if (type === "business") {
    column = "business_profile_base64";
  } else {
    return res.status(400).send("Invalid type. Use 'user' or 'business'.");
  }

  const query = `SELECT ${column} FROM owner WHERE user_email = ?`;

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Database error.");
    }

    if (results.length === 0) {
      return res.status(404).send("Owner not found.");
    }

    const imageBase64 = results[0][column];
    if (!imageBase64) {
      return res.status(404).send("Image not found.");
    }

    res.send({ user_email, type, imageBase64 });
  });
});

router.post("/update-business-profile-image", (req, res) => {
  const user_email = req.headers['x-user-email'];

  if (!user_email) {
    return res.status(400).send("Missing user email header.");
  }

  try {
    // Create user directory if it doesn't exist
    const baseDir = path.join(__dirname, "..", "root");
    const userDir = path.join(baseDir, user_email);

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir);
    }

    // Generate filename with timestamp to avoid conflicts
    const fileExt = req.headers['content-type']?.split('/')[1] || 'jpeg';
    const filename = `business_profile.${fileExt}`;
    const filepath = path.join(userDir, filename);
    const fileUrlPath = `/root/${user_email}/${filename}`;

    // Create write stream
    const writeStream = fs.createWriteStream(filepath);

    // Pipe request body directly to file
    req.pipe(writeStream);

    // Handle completion and errors
    writeStream.on('finish', () => {
      // Update database with file path instead of base64
      const query = `UPDATE owner SET business_profile_base64 = ? WHERE user_email = ?`;
      const values = [fileUrlPath, user_email];

      db.query(query, values, (err, result) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).send("Database error.");
        }

        if (result.affectedRows === 0) {
          return res.status(404).send("Owner not found.");
        }

        res.json({
          message: "Business profile image updated successfully.",
          imagePath: fileUrlPath
        });
      });
    });

    writeStream.on('error', (err) => {
      console.error('Error writing file:', err);
      res.status(500).send("Error saving image.");
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).send("Server error.");
  }
});

// Serve business profile image by email
router.get("/business-profile-image/:user_email", (req, res) => {
  const user_email = req.params.user_email;

  if (!user_email) {
    return res.status(400).send("Missing user email");
  }

  // Get the profile image path from the database
  db.query(
    "SELECT business_profile_base64 FROM owner WHERE user_email = ?",
    [user_email],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Database error");
      }

      if (results.length === 0) {
        return res.status(404).send("User not found");
      }

      const imagePath = results[0].business_profile_base64;

      if (!imagePath) {
        return res.status(404).send("No business profile image found");
      }

      // Determine the content type based on the image format
      let contentType = "image/jpeg"; // Default

      if (imagePath.endsWith(".png")) {
        contentType = "image/png";
      } else if (imagePath.endsWith(".gif")) {
        contentType = "image/gif";
      }

      // If it's a file path (new format)
      if (imagePath.startsWith('/root/')) {
        // Use the same path resolution logic as other endpoints
        const serverRootDir = path.join(__dirname, '..');
        const relativePath = imagePath;
        const fullPath = path.join(serverRootDir, relativePath);

        if (fs.existsSync(fullPath)) {
          res.setHeader('Content-Type', contentType);
          return res.sendFile(fullPath);
        }

        // Try alternative path as fallback
        const altPath = path.resolve(serverRootDir, `.${relativePath}`);

        if (fs.existsSync(altPath)) {
          res.setHeader('Content-Type', contentType);
          return res.sendFile(altPath);
        }

        console.error(`Business profile image not found at path: ${fullPath} or ${altPath}`);
        return res.status(404).send(`Image file not found on server`);
      }
      // If it's base64 (old format)
      else if (imagePath.startsWith('data:')) {
        try {
          // Extract content type and base64 data
          const matches = imagePath.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

          if (!matches || matches.length !== 3) {
            console.error(`Invalid image data format: ${imagePath.substring(0, 30)}...`);
            return res.status(400).send("Invalid image data format");
          }

          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');

          res.setHeader('Content-Type', matches[1]);
          return res.send(buffer);
        } catch (error) {
          console.error("Error processing base64 image:", error);
          return res.status(500).send("Error processing image");
        }
      } else {
        console.error(`Invalid business profile image path format: ${imagePath.substring(0, 30)}...`);
        return res.status(400).send("Invalid image format");
      }
    }
  );
});

// Create a new folder
router.post("/owner-folders/create", (req, res) => {
  const { folder_name, user_email, cover_page_base64 } = req.body;

  if (!folder_name || !user_email) {
    return res
      .status(400)
      .json({ error: "Folder name and user email are required" });
  }

  // Create directory structure for the user if it doesn't exist
  const userFolderPath = path.join(rootDirectory, user_email, 'drive', 'portfolio', 'folders', folder_name);

  // Create the full directory path if it doesn't exist
  fs.mkdirSync(userFolderPath, { recursive: true });

  let thumbnailPath = null;

  // Process and save the cover image if provided
  if (cover_page_base64 && cover_page_base64.startsWith('data:image')) {
    try {
      // Extract the base64 data and file type
      const contentType = cover_page_base64.split(';')[0].split(':')[1];
      const extension = contentType.split('/')[1];
      const base64Data = cover_page_base64.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      // Create filename for the thumbnail
      const thumbnailFilename = 'thumbnail.' + extension;
      const fullThumbnailPath = path.join(userFolderPath, thumbnailFilename);

      // Write the file
      fs.writeFileSync(fullThumbnailPath, buffer);

      // Store the relative path to be saved in the database
      thumbnailPath = `${user_email}/drive/portfolio/folders/${folder_name}/${thumbnailFilename}`;
    } catch (error) {
      console.error("Error saving folder thumbnail:", error);
      return res.status(500).json({ error: "Error saving folder thumbnail" });
    }
  }

  const query = `
    INSERT INTO owner_folders (folder_name, user_email, cover_page_base64)
    VALUES (?, ?, ?)
  `;

  db.query(
    query,
    [folder_name, user_email, thumbnailPath],
    (err, result) => {
      if (err) {
        console.error("Error creating folder:", err);
        return res.status(500).json({ error: "Error creating folder" });
      }

      res.status(201).json({
        message: "Folder created successfully.",
        folder_id: result.insertId,
        cover_path: thumbnailPath
      });
    }
  );
});

// Get all folders for a user
router.get("/owner-folders/:user_email", (req, res) => {
  const { user_email } = req.params;

  const query = `
    SELECT f.*, COUNT(ff.file_id) as file_count
    FROM owner_folders f
    LEFT JOIN owner_folders_files ff ON f.folder_id = ff.folder_id
    WHERE f.user_email = ?
    GROUP BY f.folder_id
    ORDER BY f.created_at DESC
  `;

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching folders:", err);
      return res.status(500).json({ error: "Error fetching folders" });
    }

    res.status(200).json(results);
  });
});

// Upload files to a folder
router.post("/owner-folders/upload", (req, res) => {
  const { folder_id, files } = req.body;

  if (!folder_id || !Array.isArray(files)) {
    return res.status(400).json({ error: "Invalid request data" });
  }

  const query = `
    INSERT INTO owner_folders_files (folder_id, file_name, file_type, file_data)
    VALUES (?, ?, ?, ?)
  `;

  const insertPromises = files.map((file) => {
    return new Promise((resolve, reject) => {
      db.query(
        query,
        [folder_id, file.name, file.type, file.data],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });
  });

  Promise.all(insertPromises)
    .then(() => {
      res.status(201).json({ message: "Files uploaded successfully" });
    })
    .catch((err) => {
      console.error("Error uploading files:", err);
      res.status(500).json({ error: "Error uploading files" });
    });
});

// Get all files in a folder
router.get("/owner-folders/files/:folder_id", (req, res) => {
  const { folder_id } = req.params;

  console.log(`Fetching files for folder_id: ${folder_id}`);

  const query = `
    SELECT file_id, file_name, file_type, created_at, file_data
    FROM owner_folders_files
    WHERE folder_id = ?
    ORDER BY created_at DESC
  `;

  db.query(query, [folder_id], (err, results) => {
    if (err) {
      console.error("Error fetching files:", err);
      return res.status(500).json({ error: "Error fetching files" });
    }

    console.log(`Returning ${results.length} files for folder ${folder_id}`);
    res.status(200).json(results);
  });
});

// Delete a folder and its files
router.delete("/owner-folders/:folder_id", (req, res) => {
  const { folder_id } = req.params;
  const { user_email } = req.body;

  console.log(`Attempting to delete folder ID: ${folder_id} for user: ${user_email}`);

  // First get the folder information
  const queryFind = `
    SELECT folder_name, cover_page_base64 FROM owner_folders 
    WHERE folder_id = ? AND user_email = ?
  `;

  db.query(queryFind, [folder_id, user_email], (err, results) => {
    if (err) {
      console.log("Database query failed:", err);
      return res.status(500).json({
        success: false,
        message: "Database error while finding folder"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Folder not found or unauthorized"
      });
    }

    const folderName = results[0].folder_name;
    const coverPath = results[0].cover_page_base64;

    console.log(`Found folder to delete: "${folderName}"`);

    // Check if we have a physical folder to delete
    let physicalFolderDeleted = false;

    try {
      // Build physical folder path similar to how photo deletion works
      const folderPath = path.join(__dirname, '..', 'root', user_email, 'drive', 'portfolio', 'folders', folderName);
      console.log(`Physical folder path: ${folderPath}`);

      if (fs.existsSync(folderPath)) {
        console.log(`Folder exists at ${folderPath}, attempting deletion`);

        // Use rimraf (like fs.rm) to recursively delete the folder and contents
        const { execSync } = require('child_process');

        try {
          if (process.platform === 'win32') {
            console.log('Using Windows rmdir command');
            execSync(`rmdir /s /q "${folderPath}"`);
          } else {
            console.log('Using Unix rm command');
            execSync(`rm -rf "${folderPath}"`);
          }

          physicalFolderDeleted = !fs.existsSync(folderPath);
          console.log(`Folder deletion ${physicalFolderDeleted ? 'successful' : 'failed'}`);
        } catch (deleteErr) {
          console.log(`Command-line deletion error: ${deleteErr.message}`);

          // Try manual deletion as fallback
          try {
            deleteFolderContents(folderPath);
            physicalFolderDeleted = !fs.existsSync(folderPath);
          } catch (manualErr) {
            console.log(`Manual deletion error: ${manualErr.message}`);
          }
        }
      } else {
        console.log(`Physical folder not found at ${folderPath}`);
      }
    } catch (fileErr) {
      console.log(`Error handling physical folder: ${fileErr.message}`);
    }

    // Always proceed with database deletion
    deleteFolderFromDB(folder_id, user_email, physicalFolderDeleted, res);
  });
});

// Helper function to delete folder contents recursively
function deleteFolderContents(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach(file => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        // Recursively delete contents of subdirectory
        deleteFolderContents(curPath);
        // Then delete the now-empty subdirectory
        fs.rmdirSync(curPath);
      } else {
        // Delete file
        fs.unlinkSync(curPath);
      }
    });
    // Delete the main folder itself
    fs.rmdirSync(folderPath);
  }
}

// Helper function to delete folder from database
function deleteFolderFromDB(folder_id, user_email, physicalFolderDeleted, res) {
  const query = "DELETE FROM owner_folders WHERE folder_id = ? AND user_email = ?";

  db.query(query, [folder_id, user_email], (err, result) => {
    if (err) {
      console.log("Database deletion error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete folder from database"
      });
    }

    console.log(`Successfully deleted folder ID ${folder_id} from database`);
    res.json({
      success: true,
      message: "Folder deleted successfully",
      databaseRowsDeleted: result.affectedRows,
      fileSystemDeleted: physicalFolderDeleted
    });
  });
}

// Delete specific files
router.post("/owner-folders-files/delete", (req, res) => {
  const { file_ids, folder_id, user_email } = req.body;

  if (
    !Array.isArray(file_ids) ||
    file_ids.length === 0 ||
    !folder_id ||
    !user_email
  ) {
    return res.status(400).json({ error: "Invalid request data" });
  }

  console.log(`Delete request - Folder: ${folder_id}, Files: ${file_ids.join(',')}, User: ${user_email}`);

  // Verify the user owns this folder
  const verifyQuery = `
    SELECT folder_id FROM owner_folders 
    WHERE folder_id = ? AND user_email = ?
  `;

  db.query(verifyQuery, [folder_id, user_email], (err, results) => {
    if (err) {
      console.error("Error verifying folder ownership:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res
        .status(403)
        .json({ error: "Unauthorized or folder not found" });
    }

    // First, get the file paths from the database
    const getFilesQuery = `
      SELECT file_id, file_data, file_name 
      FROM owner_folders_files 
      WHERE file_id IN (?) AND folder_id = ?
    `;

    db.query(getFilesQuery, [file_ids, folder_id], (err, files) => {
      if (err) {
        console.error("Error fetching file data:", err);
        return res.status(500).json({ error: "Error fetching file data" });
      }

      if (files.length === 0) {
        return res.status(404).json({
          message: "No files found to delete",
          deletedCount: 0,
        });
      }

      console.log(`Found ${files.length} files to delete`);

      // Delete physical files first
      const deleteResults = [];
      const fs = require('fs');
      const path = require('path');
      const serverRootDir = path.join(__dirname, '..');

      files.forEach(file => {
        try {
          // Skip base64 files
          if (file.file_data && !file.file_data.startsWith('data:')) {
            // Try the primary path first
            let filePath = path.join(serverRootDir, file.file_data);
            console.log(`Checking file at: ${filePath}`);

            let fileExists = fs.existsSync(filePath);

            // If not found, try alternative path
            if (!fileExists) {
              const altPath = path.join(path.dirname(serverRootDir), "root", file.file_data.replace('/root/', ''));
              console.log(`Checking alternative path: ${altPath}`);

              if (fs.existsSync(altPath)) {
                filePath = altPath;
                fileExists = true;
              }
            }

            if (fileExists) {
              fs.unlinkSync(filePath);
              console.log(`Deleted physical file: ${filePath}`);
              deleteResults.push({
                file_id: file.file_id,
                name: file.file_name,
                status: 'File and database record deleted'
              });
            } else {
              console.log(`File not found on disk: ${file.file_data}`);
              deleteResults.push({
                file_id: file.file_id,
                name: file.file_name,
                status: 'Database record deleted, file not found on disk'
              });
            }
          } else {
            // Base64 file, just delete the database record
            deleteResults.push({
              file_id: file.file_id,
              name: file.file_name,
              status: 'Database record deleted (base64 file)'
            });
          }
        } catch (fileErr) {
          console.error(`Error deleting physical file ${file.file_id}:`, fileErr);
          deleteResults.push({
            file_id: file.file_id,
            name: file.file_name,
            status: 'Error deleting physical file, database record will be deleted'
          });
        }
      });

      // After physical file deletion, delete database records
      const deleteQuery = `
        DELETE FROM owner_folders_files 
        WHERE file_id IN (?) AND folder_id = ?
      `;

      db.query(deleteQuery, [file_ids, folder_id], (err, result) => {
        if (err) {
          console.error("Error deleting files from database:", err);
          return res.status(500).json({ error: "Error deleting files from database" });
        }

        console.log(`Deleted ${result.affectedRows} records from database`);

        if (result.affectedRows > 0) {
          res.status(200).json({
            message: "Files deleted successfully",
            deletedCount: result.affectedRows,
            details: deleteResults
          });
        } else {
          res.status(404).json({
            message: "No files deleted from database",
            deletedCount: 0,
            details: deleteResults
          });
        }
      });
    });
  });
});

// Add package request
router.post("/add-package-request", (req, res) => {
  // Extract only the needed fields (ignore extra error fields).
  const {
    package_id,
    package_name,
    service,
    description,
    price,
    event_name,
    location,
    requirements,
    days_required,
    total_amount,
    sender_email,
    receiver_email,
    start_date,
    end_date
  } = req.body;

  // Validate required fields
  if (
    !package_id ||
    !package_name ||
    !service ||
    !description ||
    isNaN(parseFloat(price)) ||
    !event_name ||
    !location ||
    // !requirements ||
    isNaN(parseInt(days_required, 10)) ||
    isNaN(parseFloat(total_amount)) ||
    !sender_email ||
    !receiver_email ||
    !start_date ||
    !end_date
  ) {
    return res.status(400).json({ error: "Invalid or missing fields" });
  }

  // If service is an array, convert it to a comma-separated string.
  const serviceString = Array.isArray(service) ? service.join(", ") : service;

  // Format dates correctly for MySQL
  const formattedStartDate = new Date(start_date).toISOString().slice(0, 19).replace("T", " ");
  const formattedEndDate = new Date(end_date).toISOString().slice(0, 19).replace("T", " ");

  function calculateDays(startDate, endDate) {
    if (!startDate || !endDate) return "N/A";

    const start = new Date(startDate);
    const end = new Date(endDate);

    const diffTime = end - start; // Difference in milliseconds
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert to days

    return diffDays > 0 ? `${diffDays} days` : "0 days";
  }

  const calculatedDaysRequired = calculateDays(start_date, end_date);

  // Build the parameterized INSERT query.
  const query = `
    INSERT INTO event_request (
      event_request_type,      
      package_id,
      package_name,            
      service,                 
      description,             
      price,                
      event_name,              
      location,                
      requirements,            
      days_required,           
      total_amount,            
      sender_email,            
      receiver_email,          
      event_status, 
      start_date,  
      end_date,
      time_stamp        
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,Now())
  `;

  const values = [
    "package",
    package_id,
    package_name,
    serviceString,
    description,
    parseFloat(price),
    event_name,
    location,
    requirements,
    parseInt(days_required, 10),
    parseFloat(total_amount),
    sender_email,
    receiver_email,
    "Pending",
    formattedStartDate,
    formattedEndDate,
  ];


  // Execute the INSERT query.
  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error adding package request:", err);
      return res.status(500).json({ error: "Error adding package request" });
    }

    const insertQuery = `insert into notifications_pes (notification_type,notification_name,user_email,location,days_required,sender_email) values (?,?,?,?,?,?)`;
    const notifications_values = ["package", package_name, receiver_email, location, calculatedDaysRequired, sender_email];

    db.query(insertQuery, notifications_values, (insertErr, insertResult) => {
      if (insertErr) {
        console.error("Error adding notification:", insertErr);
        return res.status(500).json({ error: "Error adding notification" });
      }
      const insertedId = insertResult.insertId;
      // Fetch the inserted record
      const fetchQuery = `SELECT * FROM notifications_pes WHERE id = ?`;
      db.query(fetchQuery, [insertedId], (fetchErr, fetchResult) => {
        if (fetchErr) {
          console.error("Error fetching package request:", fetchErr);
          return res.status(500).json({ error: "Error fetching package request" });
        }
        req.io.emit(`package_notification_${receiver_email}`, { all_data: fetchResult[0], type: fetchResult[0].notification_type });


        // Send response to client
        res.status(201).json({
          message: "Package request added successfully",
          request_id: insertedId,
        });
      });
    });
  });
});


// Add equipment request
router.post("/add-equipment-request", (req, res) => {
  const {
    equipment_id,
    event_name,
    equipment_name,
    equipment_company,
    equipment_type,
    equipment_description,
    equipment_price_per_day,
    location,
    requirements,
    days_required,
    total_amount,
    sender_email,
    receiver_email,
    start_date,
    end_date,
  } = req.body;

  // Ensure all required fields exist and are valid
  if (
    !event_name ||
    !equipment_id ||
    !equipment_name ||
    !equipment_company ||
    !equipment_type ||
    !equipment_description ||
    isNaN(equipment_price_per_day) ||
    !location ||
    // !requirements ||
    isNaN(days_required) ||
    isNaN(total_amount) ||
    !sender_email ||
    !receiver_email ||
    !start_date ||
    !end_date
  ) {
    return res.status(400).json({ error: "Invalid or missing fields" });
  }


  const formattedStartDate = new Date(start_date).toISOString().slice(0, 19).replace("T", " ");
  const formattedEndDate = new Date(end_date).toISOString().slice(0, 19).replace("T", " ");

  function calculateDays(startDate, endDate) {
    if (!startDate || !endDate) return "N/A";

    const start = new Date(startDate);
    const end = new Date(endDate);

    const diffTime = end - start; // Difference in milliseconds
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert to days

    return diffDays > 0 ? `${diffDays} days` : "0 days";
  }

  const calculatedDaysRequired = calculateDays(start_date, end_date);


  const query = `
    INSERT INTO event_request (
      equipment_id,
      event_request_type,
      event_name,
      equipment_name,
      equipment_company,
      equipment_type,
      equipment_description,
      equipment_price_per_day,
      location,
      requirements,
      days_required,
      total_amount,
      sender_email,
      receiver_email,
      event_status,start_date,
      end_date,
      time_stamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,Now())
  `;

  const values = [
    equipment_id,
    "equipment",
    event_name,
    equipment_name,
    equipment_company,
    equipment_type,
    equipment_description,
    parseFloat(equipment_price_per_day),
    location,
    requirements,
    parseInt(days_required),
    parseFloat(total_amount),
    sender_email,
    receiver_email,
    "Pending",
    formattedStartDate,
    formattedEndDate,
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error adding equipment request:", err);
      return res.status(500).json({ error: "Error adding equipment request" });
    }

    const insertQuery = `insert into notifications_pes (notification_type,notification_name,user_email,location,days_required,sender_email) values (?,?,?,?,?,?)`;
    const notifications_values = ["equipment", equipment_name, receiver_email, location, calculatedDaysRequired, sender_email];

    db.query(insertQuery, notifications_values, (insertErr, insertResult) => {
      if (insertErr) {
        console.error("Error adding notification:", insertErr);
        return res.status(500).json({ error: "Error adding notification" });
      }

      const insertedId = insertResult.insertId;
      const fetchQuery = `select * from notifications_pes where id = ?`;
      db.query(fetchQuery, [insertedId], (fetchErr, fetchResult) => {
        if (fetchErr) {
          console.error("Error fetching equipment request:", err);
          return res.status(500).json({ error: "Error fetching equipment request" });
        }
        req.io.emit(`equipment_notification_${receiver_email}`, { all_data: fetchResult[0], type: fetchResult[0].notification_type });
      });
      res.status(201).json({
        message: "Equipment request added successfully",
        request_id: insertedId,
      });
    });
  });
});

// Add service request
router.post("/add-service-request", (req, res) => {
  console.log("service request at server side", req.body.receiver_email);
  const {
    event_name,
    sender_email,
    receiver_email,
    service_name,
    service_price,
    description,
    total_amount,
    requirements,
    service_id,
    start_date,
    end_date,
    location,
    days_required
  } = req.body;

  if (!event_name || !sender_email || !receiver_email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().slice(0, 19).replace('T', ' ');
  };

  const formattedStartDate = formatDate(start_date);
  const formattedEndDate = formatDate(end_date);


  function calculateDays(startDate, endDate) {
    if (!startDate || !endDate) return "N/A";

    const start = new Date(startDate);
    const end = new Date(endDate);

    const diffTime = end - start; // Difference in milliseconds
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert to days

    return diffDays > 0 ? `${diffDays} days` : "0 days";
  }

  const calculatedDaysRequired = calculateDays(start_date, end_date);

  const query = `
  INSERT INTO event_request (
    event_request_type, 
    event_name,
    service_name, 
    service_price_per_day, 
    service_description, 
    sender_email, 
    receiver_email, 
    total_amount,
    requirements,
    services_id,
    start_date,
    end_date,
    event_status,
    location,
    days_required,
    time_stamp
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, Now())
`;

  const values = [
    'service',
    event_name,
    service_name,
    service_price,
    description,
    sender_email,
    receiver_email,
    total_amount,
    requirements,
    service_id,
    formattedStartDate,
    formattedEndDate,
    'Pending',
    location,
    days_required
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error adding service request:", err);
      return res.status(500).json({ error: "Error adding service request" });
    }

    const insertQuery = `insert into notifications_pes (notification_type,notification_name,user_email,location,days_required,sender_email) values (?,?,?,?,?,?)`;
    const notifications_values = ["service", service_name, receiver_email, location, calculatedDaysRequired, sender_email];

    db.query(insertQuery, notifications_values, (insertErr, insertResult) => {
      if (insertErr) {
        console.error("Error adding notification:", insertErr);
        return res.status(500).json({ error: "Error adding notification" });
      }
      const insertedId = insertResult.insertId;

      const fetchQuery = `select * from notifications_pes where id = ?`;
      db.query(fetchQuery, [insertedId], (err, fetchResult) => {
        if (err) {
          console.error("Error fetching service request:", err);
          return res.status(500).json({ error: "Error fetching service request" });
        }
        req.io.emit(`service_notification_${receiver_email}`, { all_data: fetchResult[0], type: fetchResult[0].notification_type });
      });

      res.status(201).json({
        message: "Service request added successfully",
        request_id: insertedId,
      });
    });
  });
});

router.get("/get-package-details/:receiver_email", (req, res) => {
  const { receiver_email } = req.params;
  const query = `SELECT * FROM event_request WHERE receiver_email = ? and event_request_type=?`;
  db.query(query, [receiver_email], (err, results) => {
    if (err) {
      console.error("Error fetching package details:", err);
      return res.status(500).json({ error: "Error fetching package details" });
    }
    res.json(results);
  });
});

router.get("/get-equipment-details-by/:receiver_email", (req, res) => {
  const { receiver_email } = req.params;

  // Query to select event requests for 'package' type
  const query_packageData =
    "SELECT * FROM event_request WHERE receiver_email = ? AND event_request_type = 'package'";

  // Query to select event requests for 'equipment' type
  const query_equipmentData =
    "SELECT * FROM event_request WHERE receiver_email = ? AND event_request_type = 'equipment'";

  const query_serviceData =
    "SELECT * FROM event_request WHERE receiver_email = ? AND event_request_type = 'service'";

  // Run both queries in sequence
  db.query(query_packageData, [receiver_email], (err, packageResults) => {
    if (err) {
      console.error("Error fetching package details:", err);
      return res.status(500).json({ error: "Error fetching package details" });
    }

    db.query(query_equipmentData, [receiver_email], (err, equipmentResults) => {
      if (err) {
        console.error("Error fetching equipment details:", err);
        return res.status(500).json({ error: "Error fetching equipment details" });
      }

      db.query(query_serviceData, [receiver_email], (err, serviceResults) => {
        if (err) {
          console.error("Error fetching service details:", err);
          return res.status(500).json({ error: "Error fetching service details" });
        }


        res.json({
          package: packageResults,
          equipment: equipmentResults,
          service: serviceResults,
        });
      });
    });
  });
});

// Add a new service
router.post("/add-service", (req, res) => {
  const { service_name, price_per_day, description, user_email } = req.body;

  // Validate required fields
  if (!service_name || !price_per_day || !user_email) {
    return res.status(400).json({
      error: "Service name, price per day, and user email are required"
    });
  }

  const query = `
    INSERT INTO owner_services 
    (service_name, price_per_day, description, user_email)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    query,
    [service_name, price_per_day, description || null, user_email],
    (err, result) => {
      if (err) {
        console.error("Error adding service:", err);
        return res.status(500).json({ error: "Error adding service" });
      }

      res.status(201).json({
        message: "Service added successfully",
        service_id: result.insertId
      });
    }
  );
});

// Update an existing service
router.put("/update-service/:id", (req, res) => {
  const serviceId = req.params.id;
  const { service_name, price_per_day, description, user_email } = req.body;

  // Validate required fields
  if (!service_name || !price_per_day || !user_email || !serviceId) {
    return res.status(400).json({
      error: "Service name, price per day, user email, and service ID are required"
    });
  }

  // First verify the user owns this service
  const verifyQuery = `
    SELECT id FROM owner_services 
    WHERE id = ? AND user_email = ?
  `;

  db.query(verifyQuery, [serviceId, user_email], (err, results) => {
    if (err) {
      console.error("Error verifying service ownership:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(403).json({
        error: "Unauthorized or service not found"
      });
    }

    // Update the service
    const updateQuery = `
      UPDATE owner_services 
      SET service_name = ?, price_per_day = ?, description = ?
      WHERE id = ?
    `;

    db.query(updateQuery, [service_name, price_per_day, description || null, serviceId], (updateErr, updateResult) => {
      if (updateErr) {
        console.error("Error updating service:", updateErr);
        return res.status(500).json({ error: "Error updating service" });
      }

      res.status(200).json({
        message: "Service updated successfully",
        service: {
          id: serviceId,
          service_name,
          price_per_day,
          description,
          user_email
        }
      });
    });
  });
});

// Get services by user email
router.get("/services/:user_email", (req, res) => {
  const { user_email } = req.params;

  const query = `
    SELECT * FROM owner_services 
    WHERE user_email = ?
    ORDER BY service_name
  `;

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching services:", err);
      return res.status(500).json({ error: "Error fetching services" });
    }

    res.status(200).json(results);
  });
});

// Remove service by ID
router.delete("/remove-service/:id", (req, res) => {
  const { id } = req.params;
  const { user_email } = req.body; // For security verification

  // First verify the user owns this service
  const verifyQuery = `
    SELECT id FROM owner_services 
    WHERE id = ? AND user_email = ?
  `;

  db.query(verifyQuery, [id, user_email], (err, results) => {
    if (err) {
      console.error("Error verifying service ownership:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(403).json({
        error: "Unauthorized or service not found"
      });
    }

    // Delete the service
    const deleteQuery = `DELETE FROM owner_services WHERE id = ?`;

    db.query(deleteQuery, [id], (err, result) => {
      if (err) {
        console.error("Error deleting service:", err);
        return res.status(500).json({ error: "Error deleting service" });
      }

      res.status(200).json({
        message: "Service deleted successfully"
      });
    });
  });
});

// Add social media link(s)
router.post("/add-social-media-links", (req, res) => {
  const { user_email, links } = req.body;

  if (!user_email || !Array.isArray(links)) {
    return res.status(400).json({
      error: "User email and array of links are required"
    });
  }

  // First get existing links
  const getQuery = "SELECT social_media_links FROM owner WHERE user_email = ?";

  db.query(getQuery, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching existing links:", err);
      return res.status(500).json({ error: "Database error" });
    }

    let existingLinks = [];
    if (results[0]?.social_media_links) {
      try {
        // Handle both string and array formats
        existingLinks = typeof results[0].social_media_links === 'string' ?
          [results[0].social_media_links] :
          Array.isArray(results[0].social_media_links) ?
            results[0].social_media_links : [];
      } catch (e) {
        console.error("Error processing existing links:", e);
      }
    }

    // Combine existing and new links, removing duplicates
    const updatedLinks = [...new Set([...existingLinks, ...links])];

    // Store as JSON string
    const linksJson = JSON.stringify(updatedLinks);

    // Update the database with combined links
    const updateQuery = "UPDATE owner SET social_media_links = ? WHERE user_email = ?";

    db.query(updateQuery, [linksJson, user_email], (err, result) => {
      if (err) {
        console.error("Error updating social media links:", err);
        return res.status(500).json({ error: "Error updating links" });
      }

      res.status(200).json({
        message: "Social media links updated successfully",
        links: updatedLinks
      });
    });
  });
});

// Delete specific social media link(s)
router.delete("/remove-social-media-links", (req, res) => {
  const { user_email, links } = req.body;

  if (!user_email || !Array.isArray(links)) {
    return res.status(400).json({
      error: "User email and array of links to remove are required"
    });
  }

  // First get existing links
  const getQuery = "SELECT social_media_links FROM owner WHERE user_email = ?";

  db.query(getQuery, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching existing links:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results[0]?.social_media_links) {
      return res.status(404).json({ error: "No social media links found" });
    }

    let existingLinks = [];
    try {
      // Handle both string and array formats
      const storedLinks = results[0].social_media_links;
      if (typeof storedLinks === 'string') {
        // Try parsing as JSON first
        try {
          existingLinks = JSON.parse(storedLinks);
        } catch (e) {
          // If not valid JSON, treat as single link string
          existingLinks = [storedLinks];
        }
      } else if (Array.isArray(storedLinks)) {
        existingLinks = storedLinks;
      }
    } catch (e) {
      console.error("Error processing existing links:", e);
      return res.status(500).json({ error: "Error processing existing links" });
    }

    // Filter out the links to be removed
    const updatedLinks = existingLinks.filter(link => !links.includes(link));

    // Store as JSON string if multiple links, or plain string if single link
    const linksToStore = updatedLinks.length === 1 ?
      updatedLinks[0] :
      JSON.stringify(updatedLinks);

    // Update the database with remaining links
    const updateQuery = "UPDATE owner SET social_media_links = ? WHERE user_email = ?";

    db.query(updateQuery, [linksToStore, user_email], (err, result) => {
      if (err) {
        console.error("Error updating social media links:", err);
        return res.status(500).json({ error: "Error updating links" });
      }

      res.status(200).json({
        message: "Social media links removed successfully",
        links: updatedLinks
      });
    });
  });
});

// Get all social media links for a user
router.get("/social-media-links/:user_email", (req, res) => {
  const { user_email } = req.params;

  const query = "SELECT social_media_links FROM owner WHERE user_email = ?";

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching social media links:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    let links = [];
    if (results[0].social_media_links) {
      try {
        // Handle both string and array formats
        links = typeof results[0].social_media_links === 'string' ?
          JSON.parse(results[0].social_media_links) :
          Array.isArray(results[0].social_media_links) ?
            results[0].social_media_links : [];
      } catch (e) {
        console.error("Error processing social media links:", e);
        // If JSON parsing fails, try to handle as a single link
        links = typeof results[0].social_media_links === 'string' ?
          [results[0].social_media_links] : [];
      }
    }

    res.status(200).json({ links });
  });
});

router.get("/get-profile-image/:user_email", (req, res) => {
  const { user_email } = req.params;
  const query = `SELECT business_profile_base64 FROM owner WHERE user_email = ?`;
  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching profile image:", err);
      return res.status(500).json({ error: "Error fetching profile image" });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      profile_image: results[0].business_profile_base64
    });
  });
});


router.get("/fetch_profile_in_equipment/:sender_email", (req, res) => {
  const { sender_email } = req.params;

  const query = `
    SELECT 
      user_profile_image_base64,
      user_name,
      business_name,
      business_address,
      user_email
    FROM owner
    WHERE user_email = ?
  `;

  db.query(query, [sender_email], (err, results) => {
    if (err) {
      console.error("Error fetching profile:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(results[0]);
  });
});


router.get("/update-Notification-is-seen/:notification_type", (req, res) => {
  const { notification_type } = req.params;
  console.log("Notification Type", notification_type)
  const query = `UPDATE notifications_pes SET is_seen = 0 WHERE notification_type=?`;
  db.query(query, [notification_type], (err, results) => {
    if (err) {
      console.error("Error updating notification:", err);
      return res.status(500).json({ error: "Error updating notification" });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.status(200).json({ message: "Notification updated successfully" });
  });
});



// 


router.post("/api/upload-photo", (req, res) => {
  const user_email = req.headers['x-user-email'];
  const fileName = req.headers['x-file-name'];
  const fileType = req.headers['content-type'] || 'image/jpeg';

  if (!user_email || !fileName) {
    return res.status(400).json({
      success: false,
      message: "Missing required headers (x-user-email, x-file-name)"
    });
  }

  try {
    // Ensure directories exist with consistent path construction
    const serverRootDir = path.join(__dirname, '..');
    const baseDir = path.join(serverRootDir, 'root');
    const userDir = path.join(baseDir, user_email);
    const driveDir = path.join(userDir, 'drive');
    const portfolioDir = path.join(driveDir, 'portfolio');


    // Create directory structure if it doesn't exist
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
    if (!fs.existsSync(driveDir)) fs.mkdirSync(driveDir);
    if (!fs.existsSync(portfolioDir)) fs.mkdirSync(portfolioDir);

    // Generate unique filename to avoid conflicts
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeFileName = uniquePrefix + '-' + fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path.join(portfolioDir, safeFileName);

    // Construct the relative path as stored in the database
    const fileUrlPath = `/root/${user_email}/drive/portfolio/${safeFileName}`;

    // Create a write stream and pipe the request to it
    const writeStream = fs.createWriteStream(filePath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      // Insert record in database with file path, not the actual image data
      const query = "INSERT INTO photo_files (photo_name, photo_type, photo, user_email) VALUES (?, ?, ?, ?)";

      db.execute(query, [fileName, fileType, fileUrlPath, user_email], (err, result) => {
        if (err) {
          console.error("Error inserting photo into the database:", err);
          return res.status(500).json({
            success: false,
            message: "Failed to save the photo"
          });
        }


        // Return success with the ID and path
        res.json({
          success: true,
          message: "Photo uploaded successfully!",
          photo_id: result.insertId,
          photo_path: fileUrlPath
        });
      });
    });

    writeStream.on('error', (err) => {
      console.error(`Error writing file to ${filePath}:`, err);
      res.status(500).json({
        success: false,
        message: "Error writing file"
      });
    });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// Make sure the API endpoints exist at both paths for backward compatibility
router.post("/api/upload-photo", (req, res) => {
  const url = `/owner/api/upload-photo`;
  // Forward the request to the other handler
  req.url = url;
  router.handle(req, res);
});

// Ensure portfolio image serving endpoint uses owner/ prefix
router.get("/portfolio-image/:photo_id", (req, res) => {
  const { photo_id } = req.params;

  if (!photo_id) {
    return res.status(400).json({ error: "Photo ID is required" });
  }

  const query = "SELECT photo, photo_type FROM photo_files WHERE photo_id = ?";

  db.query(query, [photo_id], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0 || !results[0].photo) {
      console.error(`Image not found for ID: ${photo_id}`);
      return res.status(404).send("Image not found");
    }

    const imagePath = results[0].photo;
    const contentType = results[0].photo_type || 'image/jpeg';

    // If it's a file path (new format)
    if (imagePath.startsWith('/root/')) {
      // Use the same path resolution logic as the delete endpoint
      const serverRootDir = path.join(__dirname, '..');
      const relativePath = imagePath;
      const fullPath = path.join(serverRootDir, relativePath);


      if (fs.existsSync(fullPath)) {
        res.setHeader('Content-Type', contentType);
        return res.sendFile(fullPath);
      }

      // Try alternative path as fallback
      const altPath = path.resolve(serverRootDir, `.${relativePath}`);

      if (fs.existsSync(altPath)) {

        res.setHeader('Content-Type', contentType);
        return res.sendFile(altPath);
      }

      console.error(`File not found at path: ${fullPath} or ${altPath}`);
      return res.status(404).send(`Image file not found on server`);
    }
    // If it's base64 (old format)
    else if (imagePath.startsWith('data:')) {
      try {
        // Extract content type and base64 data
        const matches = imagePath.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

        if (!matches || matches.length !== 3) {
          console.error(`Invalid image data format: ${imagePath.substring(0, 30)}...`);
          return res.status(400).send("Invalid image data format");
        }

        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        res.setHeader('Content-Type', matches[1]);
        return res.send(buffer);
      } catch (error) {
        console.error("Error processing base64 image:", error);
        return res.status(500).send("Error processing image");
      }
    } else {
      console.error(`Invalid image path format: ${imagePath.substring(0, 30)}...`);
      return res.status(400).send("Invalid image format");
    }
  });
});

// Fix the delete photo endpoint with more robust path handling


// Also add a non-owner prefix version for backward compatibility
router.get("/portfolio-image/:photo_id", (req, res) => {
  const url = `/owner/portfolio-image/${req.params.photo_id}`;
  console.log(`Redirecting from /portfolio-image to ${url}`);
  // Forward the request
  req.url = url;
  router.handle(req, res);
});

// Add endpoint to get all portfolio images for a user
router.post("/owner_drive/get_portfolio", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "User email is required"
    });
  }

  const query = "SELECT photo_id, photo_name, photo_type, photo FROM photo_files WHERE user_email = ?";

  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Error fetching portfolio:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch portfolio images"
      });
    }

    // Return the files with the id and path for the client to construct URLs
    const files = results.map(file => {
      return {
        photo_id: file.photo_id,
        photo_name: file.photo_name,
        photo_type: file.photo_type,
        photo: file.photo // Return the raw path/data, client will construct proper URL
      };
    });

    res.json({
      success: true,
      files: files
    });
  });
});

// Add endpoint to delete a portfolio image
router.post("/owner_drive/delete-photo", (req, res) => {
  const { user_email, photo_id } = req.body;

  console.log(`Delete request - User: ${user_email}, Photo ID: ${photo_id}`);

  if (!user_email || !photo_id) {
    return res.status(400).json({
      success: false,
      error: "User email and photo ID are required"
    });
  }

  // First, get the photo path to delete the actual file
  const getPhotoQuery = "SELECT photo, photo_name FROM photo_files WHERE photo_id = ? AND user_email = ?";

  db.query(getPhotoQuery, [photo_id, user_email], (err, results) => {
    if (err) {
      console.error("Error fetching photo path:", err);
      return res.status(500).json({ success: false, error: "Database error" });
    }

    if (results.length === 0) {
      console.error(`Photo not found - ID: ${photo_id}, User: ${user_email}`);
      return res.status(404).json({ success: false, error: "Photo not found" });
    }

    const photoPath = results[0].photo;
    const photoName = results[0].photo_name;
    console.log(`Found photo to delete in DB: ${photoPath}, Name: ${photoName}`);

    // Delete from database first
    const deleteQuery = "DELETE FROM photo_files WHERE photo_id = ? AND user_email = ?";

    db.query(deleteQuery, [photo_id, user_email], (deleteErr, deleteResult) => {
      if (deleteErr) {
        console.error("Error deleting photo from database:", deleteErr);
        return res.status(500).json({ success: false, error: "Database error" });
      }

      console.log(`Successfully deleted from database`);

      // After database delete is successful, try to delete the physical file
      let fileDeleted = false;

      try {
        // Get the exact filename from the path
        const filename = photoPath.split('/').pop();
        console.log(`Filename to delete: ${filename}`);

        // Direct server path from logs
        const directPath = `C:\\Users\\DELL\\Desktop\\server\\root\\${user_email}\\drive\\portfolio\\${filename}`;
        console.log(`Trying to delete file at: ${directPath}`);

        if (fs.existsSync(directPath)) {
          fs.unlinkSync(directPath);
          console.log(`Successfully deleted file: ${directPath}`);
          fileDeleted = true;
        } else {
          // Try the portfolio directory scan approach
          const portfolioDir = `C:\\Users\\DELL\\Desktop\\server\\root\\${user_email}\\drive\\portfolio`;
          console.log(`Checking portfolio directory: ${portfolioDir}`);

          if (fs.existsSync(portfolioDir)) {
            const files = fs.readdirSync(portfolioDir);

            if (files.length > 0) {
              // Extract original filename part
              const parts = filename.split('-');
              if (parts.length >= 3) {
                const originalName = parts.slice(2).join('-');
                console.log(`Looking for files containing: ${originalName}`);

                // Find matching files
                const matchingFiles = files.filter(f => f.includes(originalName));
                console.log(`Found ${matchingFiles.length} matching files`);

                // Delete matching files
                for (const matchFile of matchingFiles) {
                  const fullPath = path.join(portfolioDir, matchFile);
                  try {
                    fs.unlinkSync(fullPath);
                    console.log(`Deleted matching file: ${fullPath}`);
                    fileDeleted = true;
                  } catch (e) {
                    console.error(`Failed to delete: ${e.message}`);
                  }
                }
              }
            }
          }
        }
      } catch (fileErr) {
        console.error(`Error deleting file: ${fileErr.message}`);
      }

      // Always return success since we deleted the database entry
      return res.status(200).json({
        success: true,
        message: "Photo deleted successfully",
        fileDeleted: fileDeleted
      });
    });
  });
});

router.delete("/api/delete-photo", (req, res) => {
  const user_email = req.headers['x-user-email'];
  const fileName = req.headers['x-file-name'];
  const photoId = req.headers['x-photo-id'];

  if (!user_email || (!fileName && !photoId)) {
    return res.status(400).json({
      success: false,
      message: "Missing required headers (x-user-email and either x-file-name or x-photo-id)"
    });
  }

  // If we have a filename, try to delete the file directly
  if (fileName) {
    const filePath = path.join(__dirname, '..', 'root', user_email, 'drive', 'portfolio', fileName);

    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("File deletion failed:", err);

        // If file deletion failed and we have a photo ID, try to delete by ID
        if (photoId) {
          deleteByPhotoId(user_email, photoId, res);
        } else {
          // Just delete from database if file not found
          deleteFromDatabase(user_email, fileName, null, res);
        }
      } else {
        console.log("File deleted from disk:", filePath);
        deleteFromDatabase(user_email, fileName, null, res);
      }
    });
  } else if (photoId) {
    // If we only have photo ID, use that for deletion
    deleteByPhotoId(user_email, photoId, res);
  }
});

// Helper function to delete photo by ID
function deleteByPhotoId(user_email, photoId, res) {
  // First get the filename from database
  const queryFind = "SELECT photo FROM photo_files WHERE photo_id = ? AND user_email = ?";

  db.execute(queryFind, [photoId, user_email], (err, results) => {
    if (err) {
      console.error("Database query failed:", err);
      return res.status(500).json({
        success: false,
        message: "Database error while finding photo"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Photo not found in database"
      });
    }

    const photoPath = results[0].photo;
    let fileName = null;

    // Try to extract filename to delete the file
    if (photoPath && photoPath.includes('/')) {
      const pathParts = photoPath.split('/');
      fileName = pathParts[pathParts.length - 1];

      // Try to delete the actual file
      const filePath = path.join(__dirname, '..', 'root', user_email, 'drive', 'portfolio', fileName);

      fs.unlink(filePath, (err) => {
        if (err) {
          console.error("File deletion failed (by ID):", err);
          // Continue with database deletion even if file deletion fails
        } else {
          console.log("File deleted from disk (by ID):", filePath);
        }

        // Delete from database
        deleteFromDatabase(user_email, null, photoId, res);
      });
    } else {
      // If no filename found, just delete the database entry
      deleteFromDatabase(user_email, null, photoId, res);
    }
  });
}

// Helper function to delete from database
function deleteFromDatabase(user_email, fileName, photoId, res) {
  let query;
  let params;

  if (fileName) {
    const fileUrlPath = `/root/${user_email}/drive/portfolio/${fileName}`;
    query = "DELETE FROM photo_files WHERE photo = ? AND user_email = ?";
    params = [fileUrlPath, user_email];
  } else if (photoId) {
    query = "DELETE FROM photo_files WHERE photo_id = ? AND user_email = ?";
    params = [photoId, user_email];
  } else {
    return res.status(400).json({
      success: false,
      message: "Missing filename or photo ID for database deletion"
    });
  }

  db.execute(query, params, (err, result) => {
    if (err) {
      console.error("DB delete failed:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete from database"
      });
    }

    res.json({
      success: true,
      message: "Photo deleted successfully",
      databaseRowsDeleted: result.affectedRows
    });
  });
}

// Endpoint to get file information by ID
router.get("/portfolio-image-info/:id", (req, res) => {
  const photoId = req.params.id;
  const user_email = req.headers['x-user-email'];

  if (!photoId || !user_email) {
    return res.status(400).json({
      success: false,
      message: "Missing photo ID or user email"
    });
  }

  // Query the database to get the file path
  const query = "SELECT photo, photo_name FROM photo_files WHERE photo_id = ? AND user_email = ?";
  db.execute(query, [photoId, user_email], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "File not found"
      });
    }

    const photoPath = results[0].photo;
    const photoName = results[0].photo_name;

    // Extract the filename from the path
    let fileName = "";
    if (photoPath && photoPath.includes('/')) {
      const pathParts = photoPath.split('/');
      fileName = pathParts[pathParts.length - 1];
    } else {
      fileName = photoName || photoId.toString();
    }

    res.json({
      success: true,
      fileName: fileName,
      photoPath: photoPath,
      photoName: photoName
    });
  });
});

// Simplified delete endpoint that works directly with photo ID
router.delete("/api/delete-photo-by-id/:id", (req, res) => {
  const photoId = req.params.id;
  const user_email = req.headers['x-user-email'];

  if (!photoId || !user_email) {
    return res.status(400).json({
      success: false,
      message: "Missing photo ID or user email"
    });
  }

  console.log(`Attempting to delete photo ID: ${photoId} for user: ${user_email}`);

  // First get the complete file info from database
  const queryFind = "SELECT photo, photo_name FROM photo_files WHERE photo_id = ? AND user_email = ?";

  db.execute(queryFind, [photoId, user_email], (err, results) => {
    if (err) {
      console.error("Database query failed:", err);
      return res.status(500).json({
        success: false,
        message: "Database error while finding photo"
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Photo not found in database"
      });
    }

    const photoPath = results[0].photo;
    let filePath = null;

    // Try to extract filename and create full filesystem path
    if (photoPath && photoPath.startsWith('/root/')) {
      // Example: /root/user@example.com/drive/portfolio/filename.jpg
      // We need to extract the relative path after /root/ and join with __dirname/..
      const relativePath = photoPath.substring(6); // Remove '/root/' prefix
      filePath = path.join(__dirname, '..', 'root', relativePath);

      console.log(`Attempting to delete file: ${filePath}`);

      // Try to delete the file, but continue with DB deletion regardless
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`File deletion error: ${err.message}`);
          // Continue with database deletion even if file deletion fails
        } else {
          console.log(`Successfully deleted file: ${filePath}`);
        }

        // Delete database entry
        deletePhotoFromDB(photoId, user_email, res);
      });
    } else {
      // If we can't determine the file path, just delete the database entry
      console.log(`No valid file path found, deleting database entry only`);
      deletePhotoFromDB(photoId, user_email, res);
    }
  });
});

// Helper function to delete photo entry from database
function deletePhotoFromDB(photoId, user_email, res) {
  const query = "DELETE FROM photo_files WHERE photo_id = ? AND user_email = ?";

  db.execute(query, [photoId, user_email], (err, result) => {
    if (err) {
      console.error("Database deletion error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete photo from database"
      });
    }

    console.log(`Successfully deleted photo ID ${photoId} from database`);
    res.json({
      success: true,
      message: "Photo deleted successfully",
      affectedRows: result.affectedRows
    });
  });
}

// Route to serve folder thumbnail images
router.get("/portfolio-image/folder-thumbnail/:path(*)", (req, res) => {
  try {
    const imagePath = req.params.path;
    const fullPath = path.join(rootDirectory, imagePath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send("Image not found");
    }

    // Serve the file
    res.sendFile(fullPath);
  } catch (error) {
    console.error("Error serving folder thumbnail:", error);
    res.status(500).send("Error serving image");
  }
});

// Direct file upload to folder without base64 encoding
router.post("/owner-folders/upload-direct", (req, res) => {
  // We'll use a simple multipart form parser instead of multer
  const busboy = require('busboy');
  const path = require('path');
  const fs = require('fs');

  try {
    console.log("Upload-direct endpoint hit");
    console.log("Content-Type:", req.headers['content-type']);

    const bb = busboy({ headers: req.headers });

    // Variables to collect form data
    let folder_id;
    let user_email;
    let folder_name;
    const uploadedFiles = [];
    let fileCount = 0; // Count of files processed
    let completedCount = 0; // Count of files successfully processed

    // Handle regular form fields
    bb.on('field', (name, val) => {
      console.log(`Field received: ${name} = ${val}`);
      if (name === 'folder_id') folder_id = val;
      if (name === 'user_email') user_email = val;
      if (name === 'folder_name') folder_name = val;
    });

    // Handle file fields
    bb.on('file', (name, file, info) => {
      console.log(`File received: ${name}, filename: ${info.filename}, mimeType: ${info.mimeType}`);
      fileCount++;

      if (name !== 'files') {
        console.log(`Skipping file with field name: ${name}`);
        file.resume(); // Skip this file if field name is not 'files'
        return;
      }

      const { filename, mimeType } = info;

      // Make sure required data is available
      if (!user_email || !folder_name) {
        console.log("Missing user_email or folder_name, cannot save file");
        file.resume(); // Skip this file
        return;
      }

      // Create directories if they don't exist
      const serverRootDir = path.join(__dirname, '..');
      const baseDir = path.join(serverRootDir, 'root');
      const userDir = path.join(baseDir, user_email);
      const driveDir = path.join(userDir, 'drive');
      const portfolioDir = path.join(driveDir, 'portfolio');
      const foldersDir = path.join(portfolioDir, 'folders');
      const folderDir = path.join(foldersDir, folder_name);

      // Log paths for debugging
      console.log("Saving file to:", folderDir);

      // Create directory structure if it doesn't exist
      try {
        fs.mkdirSync(folderDir, { recursive: true });
      } catch (dirErr) {
        console.error("Error creating directories:", dirErr);
      }

      // Generate unique filename to avoid conflicts
      const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const safeFileName = uniquePrefix + '-' + filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(folderDir, safeFileName);

      // Construct the relative path as stored in the database
      const fileUrlPath = `/root/${user_email}/drive/portfolio/folders/${folder_name}/${safeFileName}`;

      // Create write stream and pipe file to it
      const writeStream = fs.createWriteStream(filePath);

      // Add to list of files being processed
      const fileInfo = {
        name: filename,
        type: mimeType,
        path: fileUrlPath
      };

      // Track completion
      let fileWritten = false;

      // Handle file completion
      writeStream.on('finish', () => {
        console.log(`File saved: ${filePath}`);
        fileWritten = true;
        uploadedFiles.push(fileInfo);
        completedCount++;
      });

      // Handle errors
      writeStream.on('error', (err) => {
        console.error('Error writing file:', err);
      });

      // Pipe the file data to the file
      file.pipe(writeStream);
    });

    // Handle parsing completion
    bb.on('finish', () => {
      console.log("Finished processing request", {
        folder_id,
        uploadedFiles: uploadedFiles.length,
        totalFiles: fileCount,
        completedFiles: completedCount
      });

      if (!folder_id) {
        return res.status(400).json({ error: "Missing folder ID" });
      }

      // Wait a bit for any file writes to complete
      setTimeout(() => {
        if (uploadedFiles.length === 0) {
          return res.status(400).json({ error: "No files uploaded" });
        }

        // Insert file records in database
        const query = `
          INSERT INTO owner_folders_files (folder_id, file_name, file_type, file_data)
          VALUES (?, ?, ?, ?)
        `;

        const insertPromises = uploadedFiles.map((file) => {
          return new Promise((resolve, reject) => {
            db.query(
              query,
              [folder_id, file.name, file.type, file.path],
              (err, result) => {
                if (err) reject(err);
                else resolve({ ...result, fileName: file.name });
              }
            );
          });
        });

        Promise.all(insertPromises)
          .then((results) => {
            res.status(201).json({
              message: "Files uploaded successfully",
              files: uploadedFiles.map(f => f.name),
              total: fileCount,
              completed: completedCount,
              results: results.map(r => ({ id: r.insertId, name: r.fileName }))
            });
          })
          .catch((err) => {
            console.error("Error inserting file records:", err);
            res.status(500).json({ error: "Error uploading files" });
          });
      }, 1000); // Wait 1 second to make sure all file writes are complete
    });

    // Handle parsing errors
    bb.on('error', (err) => {
      console.error('Busboy error:', err);
      res.status(500).json({ error: "Error parsing upload request" });
    });

    // Pipe request to busboy for processing
    req.pipe(bb);
  }
  catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Serve file images by path
router.get("/portfolio-image-file", (req, res) => {
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).send("Missing file path");
  }


  try {
    // The path stored in the database starts with /root/
    // Need to resolve to the actual file location on the server
    const serverRootDir = path.join(__dirname, '..');
    const fullPath = path.join(serverRootDir, filePath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      console.error(`File not found at path: ${fullPath}`);

      // Try an alternative path as a fallback
      const altPath = path.join(path.dirname(serverRootDir), "root", filePath.replace('/root/', ''));
      console.log("Trying alternative path:", altPath);

      if (fs.existsSync(altPath)) {
        console.log("File found at alternative path");

        // Determine content type based on file extension
        const ext = path.extname(altPath).toLowerCase();
        let contentType = 'application/octet-stream'; // Default

        // Set appropriate content type based on file extension
        switch (ext) {
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.gif':
            contentType = 'image/gif';
            break;
          case '.pdf':
            contentType = 'application/pdf';
            break;
          case '.mp4':
            contentType = 'video/mp4';
            break;
        }

        // Set content type and send file
        res.setHeader('Content-Type', contentType);
        return res.sendFile(altPath);
      }

      return res.status(404).send("File not found");
    }

    // Determine content type based on file extension
    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'application/octet-stream'; // Default

    // Set appropriate content type based on file extension
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.pdf':
        contentType = 'application/pdf';
        break;
      case '.mp4':
        contentType = 'video/mp4';
        break;
    }

    // Set content type and send file
    res.setHeader('Content-Type', contentType);
    res.sendFile(fullPath);
  }
  catch (error) {
    console.error("Error serving file:", error);
    res.status(500).send("Server error");
  }
});

// Create an alias route for the portfolio-image-file endpoint for backward compatibility
router.get("/owner/portfolio-image-file", (req, res) => {
  // Forward the request to the /portfolio-image-file endpoint
  req.url = "/portfolio-image-file";
  router.handle(req, res);
});

module.exports = router;
