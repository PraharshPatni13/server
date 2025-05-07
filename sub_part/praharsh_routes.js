const express = require("express");
const mysql = require("mysql2");

const router = express.Router();
require('dotenv').config();
const {
  server_request_mode,
  write_log_file,
  error_message,
  info_message,
  success_message,
  normal_message,
  create_jwt_token,
  check_jwt_token,
} = require("./../modules/_all_help");
const {
  generate_otp,
  get_otp,
  clear_otp,
} = require("./../modules/OTP_generate");
const {
  send_welcome_page,
  send_otp_page,
} = require("./../modules/send_server_email");

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {},
});


const app = express();
const bodyParser = require("body-parser");

// Middleware to parse JSON bodies
app.use(bodyParser.json());

router.post("/get_all_notifications", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "user_email is required" })
  }
  const query = "SELECT * FROM notifications_pes WHERE user_email=? and is_seen= 1 ORDER BY id DESC"
  db.query(query, [email], (err, result) => {

    if (err) {
      console.error("Error executing query:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.length > 0) {
      return res.status(200).json({ success: true, notifications: result });
    }
    else {
      return res.status(200).json({ success: false, message: "no notifications found" });
    }
  })
})
router.post("/fetch_services_for_preview", (req, res) => {
  const { user_email } = req.body;
  if (!user_email) {
    return res.status(400).json({ error: "user_email is required" });
  }
  const query = "select * from owner_services where user_email=?"

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error executing query:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (results.length > 0) {
      return res.status(200).json({ success: true, services: results });
    } else {
      return res.status(200).json({ success: false, message: "No services found" });
    }
  })
})

router.post("/fetch_package_count", (req, res) => {
  const { owner_email } = req.body;

  if (!owner_email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const query = `SELECT COUNT(*) AS package_count FROM packages WHERE user_email = ?`;

  db.execute(query, [owner_email], (err, results) => {
    if (err) {
      console.error("Error fetching package count:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Extract count value from the results
    const packageCount = results[0]?.package_count || 0;

    return res.status(200).json({ success: true, package_count: packageCount });
  });
});
router.post("/owner_drive/get_folder_photos", (req, res) => {
  const { folder_id } = req.body;

  if (!folder_id) {
    return res.status(400).json({ error: "Folder ID is required" });
  }
  const photoQuery =
    "SELECT file_name, file_data,folder_id FROM owner_folders_files WHERE folder_id = ?";

  db.execute(photoQuery, [folder_id], (err, photoResults) => {
    if (err) {
      console.error("Error fetching folder photos:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (photoResults.length === 0) {
      return res.json({ message: "No photos found in this folder." });
    }

    return res.json({ photos: photoResults });
  });
});
router.post("/owner_drive/get_folder_preview", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Owner email is required" });
  }

  // Query to fetch all photos for the user
  const photoQuery = "SELECT * FROM photo_files WHERE user_email = ?";

  db.execute(photoQuery, [email], (photoErr, photoResults) => {
    if (photoErr) {
      console.error("Error fetching photos:", photoErr);
      return res.status(500).json({ error: "Server error" });
    }

    // Query to fetch folders
    const folderQuery =
      "SELECT folder_id, folder_name FROM owner_folders WHERE user_email = ?";

    db.execute(folderQuery, [email], (folderErr, folderResults) => {
      if (folderErr) {
        console.error("Error fetching folders:", folderErr);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      // Structuring response as requested
      const responseData = [
        {
          folder_name: "Portfolio",
          photo_list: photoResults,
        },
        ...folderResults,
      ];

      // Sending the final response
      res.json({
        success: true,
        data: responseData,
      });
    });
  });
});

// router.post("/add-team-members", (req, res) => {
//   const { user_email, team_members, event_id } = req.body;

//   // Validate input
//   if (
//     !user_email ||
//     !Array.isArray(team_members) ||
//     team_members.length === 0 ||
//     !event_id
//   ) {
//     return res.status(400).json({ message: "Invalid input data" });
//   }

//   // Extract only member IDs
//   const assignedMemberIds = team_members.map((member) => member.member_id);

//   // Convert to JSON string for storage
//   const assignedMembersJson = JSON.stringify(assignedMemberIds);

//   const sql = `
//     UPDATE event_request
//     SET assigned_team_member = ?, event_status = 'Accepted'
//     WHERE receiver_email = ? AND id = ?
//   `;

//   db.query(sql, [assignedMembersJson, user_email, event_id], (err, result) => {
//     if (err) {
//       console.error("Error updating team members:", err);
//       return res.status(500).json({ message: "Failed to assign team members" });
//     }

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ message: "No matching event found." });
//     }

//     res.json({ message: "Team members assigned successfully" });
//   });
// });


router.post("/request-update-status", (req, res) => {
  // const { id } = req.params;
  const { event_status, reason, id } = req.body;

  // SQL Query to update the request
  const sql = `UPDATE event_request SET event_status = ?, reason = ? WHERE id = ?`;

  db.query(sql, [event_status, reason, id], (err, result) => {
    if (err) {
      console.error("Error updating request:", err);
      return res.status(200).json({ message: "Internal server error" });
    }

    if (result.affectedRows === 0) {
      return res.status(200).json({ message: "Request not found" });
    }

    res.status(200).json({
      message: "Status updated successfully",
      status: "true",
      id: id,
      reason: reason,
    });
  });
});

router.get("/get-sent-all-details-by/:sender_email", (req, res) => {
  const { sender_email } = req.params;

  // Query for "package" type
  const query_packageData = `SELECT * FROM event_request WHERE sender_email = ? AND event_request_type = 'package'`;

  // Query for "equipment" type
  const query_equipmentData = `SELECT * FROM event_request WHERE sender_email = ? AND event_request_type = 'equipment'`;

  const query_serviceData = `SELECT * FROM event_request WHERE sender_email = ? AND event_request_type = 'service'`;

  // Run both queries
  db.query(query_packageData, [sender_email], (err, packageResults) => {
    if (err) {
      console.error("Error fetching package details:", err);
      return res.status(500).json({ error: "Error fetching package details" });
    }

    db.query(query_equipmentData, [sender_email], (err, equipmentResults) => {
      if (err) {
        console.error("Error fetching equipment details:", err);
        return res
          .status(500)
          .json({ error: "Error fetching equipment details" });
      }

      db.query(query_serviceData, [sender_email], (err, serviceResults) => {
        if (err) {
          console.error("Error fetching service details:", err);
          return res.status(500).json({ error: "Error fetching service details" });
        }

        res.json({
          package: packageResults,
          equipment: equipmentResults,
          service: serviceResults,
        });

      })

    });
  });
});

router.get("/get-sent-service-requests-by/:user_email", (req, res) => {
  const { user_email } = req.params;

  // Get only event_ids
  const serviceQuery = "SELECT event_ids FROM multi_day_services WHERE sender_email = ?";

  db.query(serviceQuery, [user_email], async (err, serviceResults) => {
    if (err) {
      console.error("Error fetching service requests:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (serviceResults.length === 0) {
      return res.json({ service: [] });
    }

    // Check each event_ids entry and collect event data
    try {
      const allEventData = await Promise.all(
        serviceResults.map(row => {
          return new Promise((resolve, reject) => {
            const ids = row.event_ids;
            if (!Array.isArray(ids) || ids.length === 0) {
              return resolve([]); // skip empty or invalid ids
            }

            const query = "SELECT * FROM event_request WHERE id IN (?)";
            db.query(query, [ids], (err, result) => {
              if (err) {
                console.error("Error fetching event_request for ids:", ids, err);
                return reject(err);
              }
              resolve(result); // put the result in correct index
            });
          });
        })
      );

      // Final output is array of arrays, each index has event_request rows
      res.json({ service: allEventData });

    } catch (e) {
      console.error("Unexpected error:", e);
      res.status(500).json({ error: "Unexpected server error" });
    }
  });
});
router.post("/get_equpment_by_time", (req, res) => {
  const { equipment_id } = req.body;

  const query = "SELECT equipment_id,start_date,end_date FROM event_request WHERE equipment_id = ?";

  db.query(query, [equipment_id], (err, results) => {
    if (err) {
      console.error("Error fetching equipment:", err);
      return res.status(500).send("Server error");
    }
    res.json(results);
  });
});


router.get("/api/equipment/:email", (req, res) => {
  const email = req.params.email;

  const query = "SELECT * FROM equipment WHERE user_email = ?";

  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Error fetching equipment:", err);
      return res.status(500).send("Server error");
    }
    res.json(results);
  });
});

router.get("/api/packages/:email", (req, res) => {
  const email = req.params.email;

  const query = "SELECT * FROM packages WHERE user_email = ?";

  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Error fetching packages:", err);
      return res.status(500).send("Server error");
    }
    res.json(results);
  });
});

// Route to handle the POST request for fetching owner details
router.post("/api/owner-all-details", (req, res) => {
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: "User email is required" });
  }

  // Query for fetching equipment details
  const equipmentQuery = `
      SELECT * FROM equipment
      WHERE user_email = ? LIMIT 5
    `;

  // Query for fetching package details
  const packagesQuery = `
      SELECT * FROM packages
      WHERE user_email = ? LIMIT 5
    `;

  // Query for fetching photo files details
  const photoFilesQuery = `
      SELECT * FROM photo_files
      WHERE user_email = ? LIMIT 15
    `;

  const ServiceQuery = `
      SELECT * FROM owner_services
      WHERE user_email = ? LIMIT 10
    `;

  // Execute the queries in parallel using Promise.all
  Promise.all([
    new Promise((resolve, reject) => {
      db.query(equipmentQuery, [user_email], (err, result) => {
        if (err) reject(err);
        else {
          resolve(result);
        }
      });
    }),
    new Promise((resolve, reject) => {
      db.query(packagesQuery, [user_email], (err, result) => {
        if (err) reject(err);
        else {
          resolve(result);
        }
      });
    }),
    new Promise((resolve, reject) => {
      db.query(photoFilesQuery, [user_email], (err, result) => {
        if (err) reject(err);
        else {
          resolve(result);
        }
      });
    }),
    new Promise((resolve, reject) => {
      db.query(ServiceQuery, [user_email], (err, result) => {
        if (err) reject(err);
        else {
          resolve(result);
        }
      });
    }),
  ])
    .then(
      ([equipmentResult, packagesResult, photoFilesResult, ServiceResult]) => {
        // Send the combined data as JSON
        res.json({
          equipment: equipmentResult,
          packages: packagesResult,
          photo_files: photoFilesResult,
          services: ServiceResult,
        });
      }
    )
    .catch((error) => {
      console.error("Error fetching owner details:", error);
      res.status(500).json({ error: "Internal Server Error" });
    });
});

router.post("/api/owner-table-all-details", (req, res) => {
  const { user_email } = req.body;
  if (!user_email) {
    res.status(404).json({ message: "email not found" })
  }

  const query = "select * from owner where user_email=?"

  db.query(query, [user_email], (err, result) => {
    if (err) {
      return res.status(404).json({ error: "Internal Server Error" })
    }
    res.json({ message: "Successfully sent owner data", owner: result });
  })
})

router.post("/api/owners", (req, res) => {
  const { user_email } = req.body;

  const sql = "SELECT * FROM owner where user_email != ?";

  db.query(sql, [user_email], (err, result) => {
    if (err) {
      console.error("Error fetching owners:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    const withoutPasswordData = result.map(
      ({ password, ...ownerData }) => ownerData
    );
    res.json({ result: withoutPasswordData });
  });
});

router.post("/owner_drive/delete-photo", (req, res) => {
  const { user_email, photo_id } = req.body;

  if (!user_email || !photo_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // SQL query to delete the photo
  const deletePhotoQuery =
    "DELETE FROM photo_files WHERE user_email = ? AND photo_id = ?";

  // Execute the query
  db.query(deletePhotoQuery, [user_email, photo_id], (err, results) => {
    if (err) {
      console.error("Error deleting photo:", err);
      return res.status(500).json({ error: "Failed to delete photo" });
    }

    if (results.affectedRows > 0) {
      res.status(200).json({ message: "Photo deleted successfully" });
    } else {
      res.status(404).json({ error: "Photo not found or unauthorized" });
    }
  });
});

router.post("/owner_drive/get_portfolio", (req, res) => {
  const { email } = req.body;

  // SQL query to fetch portfolio files based on user_email
  const query = "SELECT * FROM photo_files  WHERE user_email = ?";

  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Error fetching portfolio files:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (results.length > 0) {
      res.json({ success: true, files: results });
    } else {
      res
        .status(200)
        .json({ success: false, message: "No portfolio found for this user." });
    }
  });
});


router.post("/upload-invoice-logo", async (req, res) => {
  const { image, user_email } = req.body;

  if (!image || !user_email) {
    return res
      .status(200)
      .json({ error: "Both image and user_email are required." });
  }

  const query = `
   INSERT INTO ${process.env.DB_NAME}.owner_main_invoice (user_email, invoice_logo)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE invoice_logo = VALUES(invoice_logo);
  `;
  db.query(query, [user_email, image], (err, result) => {
    if (err) {
      console.error("Error updating invoice logo:", err);
      return res.status(200).json({ error: "Failed to update invoice logo." });
    }

    if (result.affectedRows === 0) {
      return res
        .status(200)
        .json({ error: "No record found for the given email." });
    }

    res.status(200).json({ message: "Invoice logo updated successfully." });
  });
});

router.post("/upload-draft-invoice-photo", async (req, res) => {
  const { image, user_email, invoice_id } = req.body;

  if (!image || !user_email || !invoice_id) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (image, user_email, or invoice_id)",
    });
  }

  const updateQuery = `
      UPDATE invoices 
      SET invoice_logo = ?
      WHERE invoice_id = ? AND user_email = ?
    `;

  try {
    db.query(updateQuery, [image, invoice_id, user_email], (err, result) => {
      if (err) {
        console.error("Error updating invoice logo:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to update invoice logo in database",
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found or unauthorized",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Invoice logo updated successfully",
        data: {
          invoice_id,
          user_email,
        },
      });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

router.post("/get-invoice-logo", (req, res) => {
  const { user_email } = req.body; // Read user_email from the request body

  if (!user_email) {
    return res.status(400).json({ error: "user_email is required." });
  }

  const query = `
      SELECT invoice_logo
      FROM ${process.env.DB_NAME}.owner_main_invoice
      WHERE user_email = ?
    `;

  db.query(query, [user_email], (err, result) => {
    if (err) {
      console.error("Error fetching invoice logo:", err);
      return res.status(500).json({ error: "Failed to fetch invoice logo." });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: "Invoice logo not found." });
    }

    res.status(200).json({ invoice_logo: result[0].invoice_logo });
  });
});

app.post("/api/addService", (req, res) => {
  const { packageId, service } = req.body;

  if (!packageId || !service) {
    return res
      .status(400)
      .json({ message: "Package ID and service name are required" });
  }

  // SQL query to fetch the package
  const getPackageQuery = "SELECT * FROM packages WHERE id = ?";
  db.query(getPackageQuery, [packageId], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Error fetching package", error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Package not found" });
    }

    const package = results[0];

    // Add the new service to the existing services array (as a string, or you can store it as a JSON array depending on your schema)
    const updatedServices = package.service
      ? [...JSON.parse(package.service), service]
      : [service];

    // SQL query to update the package's service column
    const updatePackageQuery = "UPDATE packages SET service = ? WHERE id = ?";
    db.query(
      updatePackageQuery,
      [JSON.stringify(updatedServices), packageId],
      (err, updateResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Error updating package", error: err });
        }

        res
          .status(200)
          .json({ message: "Service added successfully", packageId });
      }
    );
  });
});

router.delete("/api/packages/:id", (req, res) => {
  const packageId = req.params.id;

  if (!packageId) {
    res.status(200).json({ message: "Package not found" });
  }

  const sql = "DELETE FROM packages WHERE id = ?";
  db.query(sql, [packageId], (err, result) => {
    if (err) {
      console.error("Error deleting package:", err);
      return res.status(200).json({ message: "Server error" });
    }
    if (result.affectedRows === 0) {
      return res.status(200).json({ message: "Package not found" });
    }

    res.json({ message: "Package deleted successfully" });
  });
});

router.put("/api/update_package", async (req, res) => {
  const {
    id,
    package_name,
    service,
    description,
    price,
    card_color,
    user_email,
  } = req.body;

  // Validate required fields
  if (!id || !user_email) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Process service field (ensure it’s a JSON string or NULL if empty)
  let formattedService = service;
  if (Array.isArray(service)) {
    const filteredServices = service.filter((s) => s.trim() !== ""); // Remove empty services
    formattedService = filteredServices.length
      ? JSON.stringify(filteredServices)
      : null;
  }

  // Extract the updated fields
  const updates = [];
  const values = [];

  if (package_name !== undefined) {
    updates.push("package_name = ?");
    values.push(package_name);
  }
  if (formattedService !== undefined) {
    updates.push("service = ?");
    values.push(formattedService);
  }
  if (description !== undefined) {
    updates.push("description = ?");
    values.push(description);
  }
  if (price !== undefined) {
    updates.push("price = ?");
    values.push(price);
  }
  if (card_color !== undefined) {
    updates.push("card_color = ?");
    values.push(card_color);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No fields to update." });
  }

  const query = `
      UPDATE packages 
      SET ${updates.join(", ")} 
      WHERE id = ? AND user_email = ?
  `;
  values.push(id, user_email);

  try {
    db.query(query, values, (err, result) => {
      if (err) {
        console.error("Error updating package:", err);
        return res.status(500).json({ error: "Failed to update package." });
      }

      if (result.affectedRows > 0) {
        res.status(200).json({
          message: "Package updated successfully!",
          updatedFields: updates.map((u) => u.split("=")[0].trim()),
        });
      } else {
        res.status(404).json({
          error:
            "Package not found or you do not have permission to update it.",
        });
      }
    });
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Failed to update package." });
  }
});

router.post("/api/fetch_packages", (req, res) => {
  const { user_email } = req.body;
  const fetchQuery = `
      SELECT * FROM packages WHERE user_email = ?
    `;
  db.query(fetchQuery, [user_email], (err, rows) => {
    if (err) {
      console.error("Error fetching packages:", err);
      return res.status(500).json({ error: "Failed to fetch packages" });
    }
    res.json(rows);
  });
});

router.post("/api/packages", (req, res) => {
  const { package_name, service, description, price, user_email, card_color } =
    req.body;

  // Validate if the service field is a valid JSON string
  let servicesJson;
  try {
    servicesJson = JSON.stringify(service); // Convert object/array to JSON string
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON format for services" });
  }

  const insertQuery = `
      INSERT INTO packages (package_name, service, description, price,card_color, user_email)
      VALUES (?, ?, ?, ?, ?,?)
    `;

  db.query(
    insertQuery,
    [package_name, servicesJson, description, price, card_color, user_email],
    (err, result) => {
      if (err) {
        console.error("Error inserting package:", err);
        return res.status(500).json({ error: "Failed to add package" });
      }

      // Fetch the inserted package to confirm
      const fetchQuery = `
          SELECT * FROM packages WHERE id = ?
        `;
      db.query(fetchQuery, [result.insertId], (err, rows) => {
        if (err) {
          console.error("Error fetching inserted package:", err);
          return res.status(500).json({ error: "Failed to retrieve package" });
        }

        res.status(200).json({
          success: true,
          message: "Package added successfully",
          results: rows[0],
        });
      });
    }
  );
});

// router.post("/save-draft-invoice", (req, res) => {
//   const {
//     invoice_id,
//     invoice_to,
//     invoice_to_address,
//     invoice_to_email,
//     date,
//     sub_total,
//     gst,
//     total,
//     user_email,
//     items,
//     as_draft,
//   } = req.body;

//   // Validate required fields
// if (!invoice_id || !user_email || !invoice_to || !as_draft) {
//     return res.status(400).json({ error: "Missing required fields" });
//   }

//   // Query to update the invoice
//   const queryInvoice = `
//       UPDATE invoices 
//       SET 
//         date = ?, 
//         sub_total = ?, 
//         gst = ?, 
//         total = ?, 
//         invoice_to = ?, 
//         as_draft = ? 
//       WHERE invoice_id = ? and user_email= ?;
//     `;

//   // Update invoice details in the database
//   db.query(
//     queryInvoice,
//     [
//       date || null,
//       sub_total || null,
//       gst || null,
//       total || null,
//       invoice_to || null,
//       as_draft,
//       invoice_id,
//       user_email,
//     ],
//     (err, result) => {
//       if (err) {
//         console.error("Database error:", err);
//         return res.status(500).json({ error: err.message });
//       }

//       // Handle items if any exist
//       if (items && items.length > 0) {
//         let totalItems = items.length;
//         let completedItems = 0;
//         let hasError = false;

//         items.forEach((all_items) => {
//           const { item, quantity, price, amount } = all_items;

//           // Query to check if item already exists in invoice_items
//           const queryCheckItemExists = `
//               SELECT id FROM invoice_items 
//               WHERE item = ? AND invoice_id = ?;
//             `;

//           // Query to insert a new item into invoice_items
//           const queryInsertItem = `
//               INSERT INTO invoice_items (
//                 invoice_id, user_email, item, quantity, price, amount, invoice_to_address, invoice_to_email
//               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
//             `;

//           // Query to update an existing item in invoice_items
//           const queryUpdateItem = `
//               UPDATE invoice_items
//               SET 
//                 quantity = ?, 
//                 price = ?, 
//                 amount = ?, 
//                 invoice_to_address = ?, 
//                 invoice_to_email = ? 
//               WHERE id = ?;
//             `;

//           // Check if item exists
//           db.query(queryCheckItemExists, [item, invoice_id], (err, results) => {
//             if (err) {
//               console.error("Error checking if item exists:", err);
//               if (!hasError) {
//                 hasError = true;
//                 return res.status(500).json({ error: err.message });
//               }
//               return;
//             }

//             if (results.length > 0) {
//               const itemId = results[0].id;
//               // Update existing item
//               db.query(
//                 queryUpdateItem,
//                 [
//                   quantity,
//                   price,
//                   amount,
//                   invoice_to_address,
//                   invoice_to_email,
//                   itemId,
//                 ],
//                 (err) => {
//                   if (err) {
//                     console.error("Error updating item:", err);
//                     if (!hasError) {
//                       hasError = true;
//                       return res.status(500).json({ error: err.message });
//                     }
//                     return;
//                   }
//                   completedItems++;
//                   if (completedItems === totalItems && !hasError) {
//                     res.json({
//                       message: "Invoice and items updated successfully",
//                       invoice_id,
//                       date,
//                       invoiceResult: result,
//                     });
//                   }
//                 }
//               );
//             } else {
//               // Insert new item
//               db.query(
//                 queryInsertItem,
//                 [
//                   invoice_id,
//                   user_email,
//                   item,
//                   quantity,
//                   price,
//                   amount,
//                   invoice_to_address,
//                   invoice_to_email,
//                 ],
//                 (err) => {
//                   if (err) {
//                     console.error("Error inserting item:", err);
//                     if (!hasError) {
//                       hasError = true;
//                       return res.status(500).json({ error: err.message });
//                     }
//                     return;
//                   }
//                   completedItems++;
//                   if (completedItems === totalItems && !hasError) {
//                     res.json({
//                       message: "Invoice and items added/updated successfully",
//                       invoice_id,
//                       date,
//                       invoiceResult: result,
//                     });
//                   }
//                 }
//               );
//             }
//           });
//         });
//       } else {
//         // No items to handle, send response
//         res.json({
//           message: "Invoice with draft added successfully",
//           invoice_id,
//           date,
//           result,
//         });
//       }
//     }
//   );
// });

router.post("/save-draft-invoice", (req, res) => {
  const {
    invoice_id,
    invoice_to,
    invoice_to_address,
    invoice_to_email,
    date,
    sub_total,
    gst,
    total,
    user_email,
    items,
    as_draft,
    terms
  } = req.body;

  // Validate required fields
  if (!invoice_id || !user_email || !invoice_to || !as_draft) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Query to update the invoice
  const queryInvoice = `
    UPDATE invoices 
    SET 
      date = ?, 
      sub_total = ?, 
      gst = ?, 
      total = ?, 
      invoice_to = ?, 
      as_draft = ? ,
      terms_conditions = ?
    WHERE invoice_id = ? and user_email = ?;
  `;

  // Update invoice details
  db.query(
    queryInvoice,
    [
      date || null,
      sub_total || null,
      gst || null,
      total || null,
      invoice_to || null,
      as_draft,
      terms,
      invoice_id,
      user_email,
    ],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      // ✅ Remove all existing items for this invoice before adding new ones
      const deleteExistingItemsQuery = `DELETE FROM invoice_items WHERE invoice_id = ?`;

      db.query(deleteExistingItemsQuery, [invoice_id], (err) => {
        if (err) {
          console.error("Error deleting existing items:", err);
          return res.status(500).json({ error: err.message });
        }

        if (items && items.length > 0) {
          let totalItems = items.length;
          let completedItems = 0;
          let hasError = false;

          items.forEach((all_items) => {
            const { item, quantity, price, amount } = all_items;

            // ✅ Insert new item directly (since all previous items are deleted)
            const queryInsertItem = `
              INSERT INTO invoice_items (
                invoice_id, user_email, item, quantity, price, amount, invoice_to_address, invoice_to_email
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            `;

            db.query(
              queryInsertItem,
              [
                invoice_id,
                user_email,
                item,
                quantity,
                price,
                amount,
                invoice_to_address,
                invoice_to_email,
              ],
              (err) => {
                if (err) {
                  console.error("Error inserting item:", err);
                  if (!hasError) {
                    hasError = true;
                    return res.status(500).json({ error: err.message });
                  }
                  return;
                }

                completedItems++;
                if (completedItems === totalItems && !hasError) {
                  return res.json({
                    message: "Invoice and items saved successfully",
                    invoice_id,
                    date,
                    invoiceResult: result,
                  });
                }
              }
            );
          });
        } else {
          // ✅ No items to add (after deleting existing items)
          return res.json({
            message: "Invoice updated successfully, all previous items removed",
            invoice_id,
            date,
            result,
          });
        }
      });
    }
  );
});

router.post("/add-draft-as-invoice", (req, res) => {
  const {
    invoice_id,
    invoice_to,
    invoice_to_address,
    invoice_to_email,
    date,
    sub_total,
    gst,
    total,
    user_email,
    items,
    as_draft,
    signature_file,
    terms
  } = req.body;

  if (!date) {
    return res.status(400).json({ error: "Date is required." });
  }

  // Insert or update the invoice in the invoices table
  const queryInvoice = `
      UPDATE invoices
      SET 
        date = ?, 
        sub_total = ?, 
        gst = ?, 
        total = ?, 
        invoice_to = ?, 
        as_draft = ?,
        terms_conditions = ?,
        signature_image = ?
      WHERE invoice_id = ? AND user_email = ?
    `;

  db.query(
    queryInvoice,
    [date, sub_total, gst, total, invoice_to, as_draft, terms, signature_file, invoice_id, user_email],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (items && items.length > 0) {
        const queryCheckItemExists = `
            SELECT id FROM invoice_items 
            WHERE item = ? AND invoice_id = ?;
          `;

        const queryInsertItem = `
            INSERT INTO invoice_items (
              invoice_id, user_email, item, quantity, price, amount, invoice_to_address, invoice_to_email
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
          `;

        const queryUpdateItem = `
            UPDATE invoice_items
            SET 
              quantity = ?, 
              price = ?, 
              amount = ?, 
              invoice_to_address = ?, 
              invoice_to_email = ?
            WHERE id = ?;
          `;

        let completedItems = 0;
        let errorsOccurred = false;

        // Loop through items and insert or update them
        items.forEach((all_items) => {
          const { item, quantity, price, amount } = all_items;

          // Step 1: Check if the item already exists in the invoice_items table
          db.query(queryCheckItemExists, [item, invoice_id], (err, results) => {
            if (err) {
              console.error("Error checking if item exists:", err);
              return res.status(500).json({ error: err.message });
            }

            if (results.length > 0) {
              // Step 2: If the item exists, update it
              const itemId = results[0].id;
              db.query(
                queryUpdateItem,
                [
                  quantity,
                  price,
                  amount,
                  invoice_to_address,
                  invoice_to_email,
                  itemId,
                ],
                (err, updateResult) => {
                  if (err) {
                    console.error("Error updating item:", err);
                    errorsOccurred = true;
                    return res.status(500).json({
                      error: "Error updating item",
                      details: err.message,
                    });
                  }
                  completedItems++;
                  if (completedItems === items.length && !errorsOccurred) {
                    res.json({
                      message: "Draft invoice and items updated successfully",
                      invoice_id,
                      date,
                      invoiceResult: result,
                    });
                  }
                }
              );
            } else {
              // Step 3: If the item doesn't exist, insert it as a new entry
              db.query(
                queryInsertItem,
                [
                  invoice_id,
                  user_email,
                  item,
                  quantity,
                  price,
                  amount,
                  invoice_to_address,
                  invoice_to_email,
                ],
                (err, insertResult) => {
                  if (err) {
                    console.error("Error inserting item:", err);
                    errorsOccurred = true;
                    return res.status(500).json({
                      error: "Error inserting item",
                      details: err.message,
                    });
                  }
                  completedItems++;
                  if (completedItems === items.length && !errorsOccurred) {
                    res.json({
                      message:
                        "Draft invoice and items added or updated successfully",
                      invoice_id,
                      date,
                      invoiceResult: result,
                    });
                  }
                }
              );
            }
          });
        });
      } else {
        // If no items are provided, send response for the invoice
        res.json({
          message: "Draft invoice added successfully",
          invoice_id,
          date,
          result,
        });
      }
    }
  );
});

router.post("/get-invoice-items", (req, res) => {
  const { invoice_id, user_email } = req.body;

  const queryItems =
    `SELECT * FROM ${process.env.DB_NAME}.invoice_items WHERE invoice_id = ? AND user_email = ?`;

  db.query(queryItems, [invoice_id, user_email], (err, items) => {
    if (err) {
      return res.status(500).json({
        error: "Database error",
        details: err,
      });
    }

    if (items && items.length > 0) {
      res.status(200).json({
        success: true,
        items: items,
      });
    } else {
      res.status(404).json({
        success: false,
        message: "No items found for this invoice",
      });
    }
  });
});

router.post("/api/delete-invoice", (req, res) => {
  const { invoice_id, user_email } = req.body;

  if (!invoice_id && !user_email) {
    return res
      .status(400)
      .json({ success: false, message: "Invoice ID is required." });
  }

  const deleteQuery =
    "DELETE FROM invoices WHERE invoice_id = ? and user_email = ?";

  db.query(deleteQuery, [invoice_id, user_email], (err, result) => {
    if (err) {
      console.error("Error deleting invoice:", err);
      return res
        .status(200)
        .json({ success: false, message: "Failed to delete invoice." });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Invoice not found." });
    }

    res.json({ success: true, message: "Invoice deleted successfully." });
  });
});

router.post("/save-draft", (req, res) => {
  const {
    invoice_id,
    invoice_to,
    invoice_to_address,
    invoice_to_email,
    date,
    sub_total,
    gst,
    total,
    user_email,
    items,
    as_draft,
    invoice_logo,
    signature_file,
    terms
  } = req.body;
  console.log("server side ", req.body);
  console.log("server side ", invoice_id);


  if (!invoice_id || !user_email || !invoice_to || !as_draft) {
    return res.status(200).json({ error: "Missing required fields" });
  }

  // Insert the invoice into the invoices table
  const queryInvoice = `INSERT INTO invoices (
      invoice_id, user_email, date, sub_total, gst, total, invoice_to,as_draft,invoice_logo,signature_image,terms_conditions
    ) VALUES (?, ?, ?, ?, ?, ?, ?,?,?,?,?);`;

  db.query(
    queryInvoice,
    [
      invoice_id,
      user_email,
      date || null,
      sub_total || null,
      gst || null,
      total || null,
      invoice_to || null,
      as_draft,
      invoice_logo,
      signature_file || null,
      terms || null
    ],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      // Once the invoice is inserted, insert the items into the items table
      if (items && items.length > 0) {
        let completedItems = 0;

        items.forEach((all_items) => {
          const { item, quantity, price, amount } = all_items;

          const queryItem = `INSERT INTO invoice_items (
              invoice_id,user_email, item, quantity, price, amount, invoice_to_address, invoice_to_email
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;

          db.query(
            queryItem,
            [
              invoice_id,
              user_email,
              item,
              quantity,
              price,
              amount,
              invoice_to_address,
              invoice_to_email,
            ],
            (err, itemResult) => {
              if (err) {
                console.error("Error inserting item:", err);
                return res.status(500).json({
                  error: "Error inserting item",
                  details: err.message,
                });
              }

              completedItems++;

              // Only proceed when all items have been inserted
              if (completedItems === items.length) {
                // Update the invoice ID counter
                db.query(
                  "UPDATE owner_main_invoice SET max_invoice_id = max_invoice_id + 1 WHERE user_email = ?",
                  [user_email],
                  (err, updateResult) => {
                    if (err) {
                      console.error(err);
                      return res.status(500).json({
                        error: "Error updating invoice ID",
                        details: err.message,
                      });
                    }

                    // Send the final response after everything is complete
                    res.json({
                      message: "Invoice items with draft added successfully",
                      invoice_id,
                      date: date,
                      invoiceResult: result,
                    });
                  }
                );
              }
            }
          );
        });
      } else {
        // If no items are provided, just send the invoice response
        res.json({
          message: "Invoice with draft added successfully",
          invoice_id,
          date: date,
          result,
        });
      }
    }
  );
});

router.post("/check_email_owner", (req, res) => {
  const { user_email } = req.body;
  const query =
    `SELECT * FROM ${process.env.DB_NAME}.owner_main_invoice WHERE user_email = ?`;

  db.query(query, [user_email], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    if (result.length > 0) {
      return res.json(result);
    } else {
      const insertQuery =
        `INSERT INTO ${process.env.DB_NAME}.owner_main_invoice (user_email, max_invoice_id) VALUES (?, 0)`;
      db.query(insertQuery, [user_email], (insertErr, insertResult) => {
        if (insertErr) {
          console.log("insertErr", insertErr);
          return res.status(200).json({ error: insertErr.message });
        }
        return res.json([
          {
            user_email: user_email,
            max_id: 0,
            message: "new record created",
          },
        ]);
      });
    }
  });
});

router.post("/generate-invoice", (req, res) => {
  const { user_email } = req.body;

  // Query to get the maximum invoice ID
  const query =
    "SELECT  max_invoice_id FROM owner_main_invoice WHERE user_email = ?";

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    let maxInvoiceId = results[0]?.max_invoice_id || 0;

    const newInvoiceId = parseInt(maxInvoiceId) + 1;

    // Send the response
    res.json({ invoice_id: newInvoiceId });
  });
});

router.post("/invoice-items", (req, res) => {
  const { invoice_id, user_email } = req.body;
  const query =
    `SELECT * FROM ${process.env.DB_NAME}.invoice_items WHERE invoice_id = ? AND user_email = ?`;
  db.query(query, [invoice_id, user_email], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

router.post("/upload-signature", (req, res) => {
  const { user_email, signature_file } = req.body;

  const query = `UPDATE ${process.env.DB_NAME}.owner_main_invoice SET signature_image = ? WHERE user_email = ?`;

  db.query(query, [signature_file, user_email], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Signature uploaded successfully" });
  });

})

router.post("/upload-signature-draft", (req, res) => {
  const { user_email, signature_file, invoice_id } = req.body;

  const query = `UPDATE ${process.env.DB_NAME}.invoices SET signature_image = ? WHERE user_email = ? and invoice_id = ?`;

  db.query(query, [signature_file, user_email, invoice_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Signature uploaded successfully" });
  });

})


router.post("/fetch_signature_terms", (req, res) => {
  const { user_email } = req.body;
  if (!user_email) {
    return res.status(400).json({ error: "User email is required." });
  }
  const query = `select signature_image, terms_conditions from ${process.env.DB_NAME}.owner_main_invoice where user_email = ?`;
  db.query(query, [user_email], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    const image = result.length > 0 ? result[0].signature_image : null;
    // console.log("result of the owner main", result[0])
    res.json({ image, terms: result[0].terms_conditions });
  })
})

router.post("/fetch_signature_terms_draft", (req, res) => {
  const { user_email, invoice_id } = req.body;
  if (!user_email) {
    return res.status(400).json({ error: "User email is required." });
  }
  const query = `select signature_image, terms_conditions from ${process.env.DB_NAME}.invoices where user_email = ? and invoice_id = ?`;
  db.query(query, [user_email, invoice_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    const image = result.length > 0 ? result[0].signature_image : null;
    // console.log("result of the owner main", result[0])
    res.json({ image, terms: result[0].terms_conditions });
  })
})

router.post("/add-invoice", (req, res) => {
  const {
    invoice_id,
    invoice_to,
    invoice_to_address,
    invoice_to_email,
    date,
    sub_total,
    gst,
    total,
    user_email,
    items,
    invoice_photo,
    invoice_signature,
    terms_condition,
  } = req.body;

  if (!date) {
    return res.status(400).json({ error: "Date is required." });
  }

  // Insert the invoice into the invoices table
  const queryInvoice = `INSERT INTO invoices (
      invoice_id, user_email, date, sub_total, gst, total, invoice_to,as_draft,invoice_logo,signature_image,terms_conditions
    ) VALUES (?, ?, ?, ?, ?, ?, ?,0,?,?,?);`;

  db.query(
    queryInvoice,
    [
      invoice_id,
      user_email,
      date,
      sub_total,
      gst,
      total,
      invoice_to,
      invoice_photo,
      invoice_signature,
      terms_condition,
    ],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (items && items.length > 0) {
        let completedItems = 0;

        items.forEach((all_items) => {
          const { item, quantity, price, amount } = all_items;

          const queryItem = `INSERT INTO invoice_items (
              invoice_id,user_email, item, quantity, price, amount, invoice_to_address, invoice_to_email
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;

          db.query(
            queryItem,
            [
              invoice_id,
              user_email,
              item,
              quantity,
              price,
              amount,
              invoice_to_address,
              invoice_to_email,
            ],
            (err, itemResult) => {
              if (err) {
                console.error("Error inserting item:", err);
                return res.status(500).json({
                  error: "Error inserting item",
                  details: err.message,
                });
              }

              completedItems++;

              if (completedItems === items.length) {
                db.query(
                  `UPDATE owner_main_invoice 
                  SET max_invoice_id = max_invoice_id + 1, 
                      terms_conditions = ? 
                  WHERE user_email = ?`,
                  [terms_condition, user_email],
                  (err, updateResult) => {
                    if (err) {
                      console.error(err);
                      return res.status(500).json({
                        error: "Error updating invoice ID",
                        details: err.message,
                      });
                    }

                    // Send the final response after everything is complete
                    res.json({
                      message: "Invoice and items added successfully",
                      invoice_id,
                      date: date,
                      invoiceResult: result,
                    });
                  }
                );
              }
            }
          );
        });
      } else {
        // If no items are provided, just send the invoice response
        res.json({
          message: "Invoice added successfully",
          invoice_id,
          date: date,
          result,
        });
      }
    }
  );
});

// router.post("/invoices/without-draft", (req, res) => {
//   const { user_email } = req.body;

//   // Query for invoices without drafts
//   const queryWithoutDraft =
//     "SELECT * FROM u300194546_ph.invoices WHERE user_email = ? AND as_draft = 0 ORDER BY id";

//   // Execute the query
//   db.query(queryWithoutDraft, [user_email], (err, result) => {
//     if (err)
//       return res.status(500).json({ error: "Database error", details: err });

//     res.status(200).json({ without_draft: result });
//   });
// });

router.post("/invoices/without-draft", (req, res) => {
  const { user_email } = req.body;

  // Query to get all invoices for the user without drafts
  const queryWithoutDraft = `
      SELECT * FROM ${process.env.DB_NAME}.invoices 
      WHERE user_email = ? AND as_draft = 0 
      ORDER BY id`;

  db.query(queryWithoutDraft, [user_email], (err, invoices) => {
    if (err) {
      return res.status(500).json({ error: "Database error", details: err });
    }

    if (invoices.length === 0) {
      return res.status(200).json({ without_draft: [] });
    }

    // Collect all invoice IDs and convert them to a proper format
    const invoiceIds = invoices.map((inv) => inv.invoice_id);

    // Query to get all items related to these invoices
    const itemsQuery = `
        SELECT * FROM ${process.env.DB_NAME}.invoice_items 
        WHERE invoice_id IN (?) AND user_email = ?`;

    db.query(itemsQuery, [invoiceIds, user_email], (err, items) => {
      if (err) {
        return res.status(500).json({ error: "Database error", details: err });
      }

      // Map items to their respective invoices
      const invoicesWithItems = invoices.map((invoice) => {
        return {
          ...invoice,
          invoice_items: items.filter(
            (item) => String(item.invoice_id) === String(invoice.invoice_id) // Ensure type consistency
          ),
        };
      });

      res.status(200).json({ without_draft: invoicesWithItems });
    });
  });
});

router.post("/invoices/with-draft", (req, res) => {
  const { user_email } = req.body;

  // Query for invoices with drafts
  const queryWithDraft =
    `SELECT * FROM ${process.env.DB_NAME}.invoices WHERE user_email = ? AND as_draft = 1 ORDER BY id`;

  // Execute the query
  db.query(queryWithDraft, [user_email], (err, result) => {
    if (err)
      return res.status(500).json({ error: "Database error", details: err });

    // Send the response with invoices with drafts
    res.status(200).json({ with_draft: result });
  });
});

router.post("/check-user-jwt", (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(200).json({ message: "Token is required" });
  }

  const data = check_jwt_token(token);

  if (!data) {
    return res.status(200).json({ message: "Invalid or expired token" });
  }

  return res.status(200).json({
    message: "Token is valid",
    data: data,
  });
});

router.post("/verify_forget_otp_client", async (req, res) => {
  const { email, type, otp } = req.body;
  if (!email || !type || !otp) {
    return res
      .status(200)
      .json({ success: false, message: "Email and Otp are required" });
  }
  const storedOtp = get_otp(email, type);
  console.log(storedOtp);

  if (storedOtp === otp) {
    res
      .status(200)
      .json({ success: true, message: "otp verified successfully" });
  } else {
    res.status(200).json({ success: false, message: "error in verifying otp" });
  }
});

router.post("/client_password_verify", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(200)
      .json({ success: false, message: "password is required" });
  }

  try {
    const query = "UPDATE clients SET user_password = ? WHERE user_email = ?";
    db.query(query, [password, email], (err, result) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ success: false, message: "Database error" });
      }

      // Check if any rows were updated
      if (result.affectedRows > 0) {
        res
          .status(200)
          .json({ success: true, message: "Password updated successfully" });
      } else {
        res.status(404).json({ success: false, message: "Email not found" });
      }
    });
  } catch (error) {
    res.status(200).json({ success: false, message: "Server error" });
  }
});

router.post("/client_email_verify", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(200)
      .json({ success: false, message: "Email is required" });
  }

  const query = "SELECT * FROM clients WHERE user_email = ?";
  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Error executing query:", err);
      return res
        .status(500)
        .json({ success: false, message: "Database error" });
    }

    if (results.length > 0) {
      const otp = generate_otp(email, "client");
      console.log("generated otp ", otp);
      send_otp_page(email, otp);

      return res.status(200).json({ success: true, message: "Email exists" });
    } else {
      return res
        .status(200)
        .json({ success: false, message: "Email not found" });
    }
  });
});

router.post("/get_client_data_from_jwt", async (req, res) => {
  const jwt_token = req.body.jwt_token;

  if (!jwt_token) {
    console.error("get_user_data_from_jwt says: JWT token is required");
    return res.status(400).send("JWT token is required");
  }

  try {
    const userData = check_jwt_token(jwt_token);

    if (!userData || !userData.user_name || !userData.user_email) {
      return res.status(200).json({ error: "Invalid or incomplete JWT token" });
    }
    const find_user =
      `SELECT * FROM ${process.env.DB_NAME}.clients WHERE user_name = ? AND user_email = ?`;

    db.query(
      find_user,
      [userData.user_name, userData.user_email],
      (err, result) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).json({ error: "Database error" });
        }
        if (result.length === 0) {
          return res.status(200).json({ message: "User not found" });
        }
        res.status(200).json({ message: "User found", user: result[0] });
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify_otp_client", async (req, res) => {
  const { type, otp, user_name, email, password } = req.body;

  if (!email || !otp || !type) {
    error_message("verify_otp say : Email and OTP are required");
    return res.status(400).json({ error: "Email and OTP are required" });
  }
  try {
    let storedOtp;
    if (type == "owner") {
      storedOtp = get_otp(email, "owner");
    } else {
      storedOtp = get_otp(email, "client");
    }
    if (storedOtp && storedOtp === otp) {
      const insertQuery =
        "INSERT INTO clients (user_name, user_email, user_password) VALUES ( ?, ?, ?)";
      db.query(insertQuery, [user_name, email, password], (err, result) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: "Database error" });
        }
        let token = create_jwt_token(email, user_name);
        res
          .status(200)
          .json({ message: "OTP verified successfully", user_key: token });
      });
    } else {
      res.status(200).json({ error: "Invalid OTP" });
    }
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "Failed to verify OTP" });
  }
});

// Route for registration of client
router.post("/client/register_user", async (req, res) => {
  const { user_name, user_email, user_password } = req.body;

  try {
    // Check if the email already exists
    db.query(
      `SELECT * FROM ${process.env.DB_NAME}.clients WHERE user_email = ? OR user_name = ?`,
      [user_email, user_name],
      (err, rows) => {
        if (err) {
          console.error("Database error", err);
          return res.status(500).json({ error: "Database error" });
        }

        if (rows.length > 0) {
          if (rows.some((row) => row.user_email === user_email)) {
            return res.status(400).json({ error: "Email already exists" });
          }
          if (rows.some((row) => row.user_name === user_name)) {
            return res.status(400).json({ error: "Username already exists" });
          }
        }
        res.status(200).json({ staus: "user_name and email verified " });
      }
    );
  } catch (e) {
    console.error("Serverside error white registering user", e);
  }
});

// Route for login client
router.post("/client/login", (req, res) => {
  const { user_email, user_password } = req.body;

  if (!user_email || !user_password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const query =
    `SELECT * FROM ${process.env.DB_NAME}.clients WHERE user_email = ? AND user_password = ?`;
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
        jwt_token: token,
      });
    } else {
      return res.status(401).json({ error: "Invalid email or password" });
    }
  });
});
router.post("/api/get-user-data", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  const query = `
      SELECT phone, address, gender
      FROM ${process.env.DB_NAME}.clients
      WHERE user_email = ?
    `;

  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Error fetching user data:", err);
      return res.status(500).json({ message: "Failed to fetch user data." });
    }

    if (results.length > 0) {
      res.status(200).json(results[0]); // Send the first matching result
    } else {
      res.status(404).json({ message: "User data not found." });
    }
  });
});

router.post("/api/update-profile", (req, res) => {
  const { user_email, user_name, phone, address, gender } = req.body;

  if (!user_email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const query = `
      UPDATE ${process.env.DB_NAME}.clients
      SET user_name = ?, phone = ?, address = ?, gender = ?
      WHERE user_email = ?
    `;

    db.query(
      query,
      [user_name, phone, address, gender, user_email],
      (err, results) => {
        if (err) {
          console.error("Error updating profile:", err);
          return res.status(500).json({ message: "Failed to update profile." });
        }
        res
          .status(200)
          .json({ message: "Profile updated successfully!", results });
      }
    );
  } catch (err) {
    console.log("error updating data");
    res.status(500).json({ message: "Failed to update data" });
  }
});

router.post("/get-invoice-items", (req, res) => {
  const { invoice_id, user_email } = req.body;

  const queryItems =
    `SELECT * FROM ${process.env.DB_NAME}.invoice_items WHERE invoice_id = ? AND user_email = ?`;

  db.query(queryItems, [invoice_id, user_email], (err, items) => {
    if (err) {
      return res.status(500).json({
        error: "Database error",
        details: err,
      });
    }

    if (items && items.length > 0) {
      res.status(200).json({
        success: true,
        items: items,
      });
    } else {
      res.status(404).json({
        success: false,
        message: "No items found for this invoice",
      });
    }
  });
});

module.exports = router;
