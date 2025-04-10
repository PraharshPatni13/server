const express = require("express");
const mysql = require("mysql2");
// const { io } = require("../server");



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
const { route } = require("./other_rout_shrey_11");
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

      const admin_id = adminResult[0].admin_id;

      // Update the user's status in the 'users' table
      const updateStatusQuery = `
        UPDATE owner
        SET user_Status = ?, admin_message = ?, set_status_by_admin = ?
        WHERE user_email = ?
      `;

      db.execute(
        updateStatusQuery,
        [user_Status, safeMessage, admin_id, user_email],
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
  const { user_email, userProfileImage } = req.body;

  if (!user_email || !userProfileImage) {
    return res.status(400).send("Missing required fields.");
  }

  const query = `UPDATE owner SET user_profile_image_base64 = ? WHERE user_email = ?`;
  const values = [userProfileImage, user_email];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Database error.");
    }

    if (result.affectedRows === 0) {
      return res.status(404).send("Owner not found.");
    }

    res.json({ message: "User profile image updated successfully." });
  });
});

router.post("/remove-profile-image-type", (req, res) => {
  const { user_email, type } = req.body;

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

  const query = `UPDATE owner SET ${column} = NULL WHERE user_email = ?`;

  db.query(query, [user_email], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Database error.");
    }

    if (result.affectedRows === 0) {
      return res.status(404).send("Owner not found.");
    }

    res.json({ message: `${type} profile image removed successfully.` });
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
  const { user_email, businessProfileImage } = req.body;

  if (!user_email || !businessProfileImage) {
    return res.status(400).send("Missing required fields.");
  }

  const query = `UPDATE owner SET business_profile_base64 = ? WHERE user_email = ?`;
  const values = [businessProfileImage, user_email];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Database error.");
    }

    if (result.affectedRows === 0) {
      return res.status(404).send("Owner not found.");
    }

    res.json({ message: "Business profile image updated successfully." });
  });
});

// Create a new folder
router.post("/owner-folders/create", (req, res) => {
  const { folder_name, user_email, cover_page_base64 } = req.body;

  if (!folder_name || !user_email) {
    return res
      .status(400)
      .json({ error: "Folder name and user email are required" });
  }

  const query = `
    INSERT INTO owner_folders (folder_name, user_email, cover_page_base64)
    VALUES (?, ?, ?)
  `;

  db.query(
    query,
    [folder_name, user_email, cover_page_base64],
    (err, result) => {
      if (err) {
        console.error("Error creating folder:", err);
        return res.status(500).json({ error: "Error creating folder" });
      }

      res.status(201).json({
        message: "Folder created successfully.",
        folder_id: result.insertId,
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

    res.status(200).json(results);
  });
});

// Delete a folder and its files
router.delete("/owner-folders/:folder_id", (req, res) => {
  const { folder_id } = req.params;
  const { user_email } = req.body;

  // First verify the user owns this folder
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

    // Delete the folder (cascade will handle file deletion)
    const deleteQuery = `DELETE FROM owner_folders WHERE folder_id = ?`;

    db.query(deleteQuery, [folder_id], (err, result) => {
      if (err) {
        console.error("Error deleting folder:", err);
        return res.status(500).json({ error: "Error deleting folder" });
      }

      res
        .status(200)
        .json({ message: "Folder and files deleted successfully" });
    });
  });
});

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

    // Delete the specified files
    const deleteQuery = `
      DELETE FROM owner_folders_files 
      WHERE file_id IN (?) AND folder_id = ?
    `;

    db.query(deleteQuery, [file_ids, folder_id], (err, result) => {
      if (err) {
        console.error("Error deleting files:", err);
        return res.status(500).json({ error: "Error deleting files" });
      }

      if (result.affectedRows > 0) {
        res.status(200).json({
          message: "Files deleted successfully",
          deletedCount: result.affectedRows,
        });
      } else {
        res.status(404).json({
          message: "No files found to delete",
          deletedCount: 0,
        });
      }
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
    "service",
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
    "Pending",
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

router.get("/update-Notification-is-seen/:notification_id", (req, res) => {
  const { notification_id } = req.params;
  const query = `UPDATE notifications_pes SET is_seen = 1 WHERE id = ?`;
  db.query(query, [notification_id], (err, results) => {
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



module.exports = router;
