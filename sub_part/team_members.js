const express = require("express");
const CryptoJS = require('crypto-js');
const router = express.Router();
const mysql = require("mysql2");
const moment = require("moment");
const fs = require('fs').promises;
const path = require('path');


require('dotenv').config();
const { send_team_invitation_email, send_owner_notification_email, send_team_event_confirmation_email, notifyEventConfirmationUpdate } = require('../modules/send_server_email');

function formatDateTime(inputStr) {
  const date = new Date(inputStr);

  const day = date.getDate();
  const month = date.toLocaleString('default', { month: 'long' });
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  return `On ${day} ${month} ${year} at ${hours}:${minutes} ${ampm}`;
}
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {},
});
const secretKey = process.env.SECRET_KEY;


function encryptEmail(email) {
  // Encrypts using AES encryption provided by CryptoJS
  return CryptoJS.AES.encrypt(email, secretKey).toString();
}
function decryptEmail(encryptedEmail) {
  try {
    // Decrypt the data
    const bytes = CryptoJS.AES.decrypt(encryptedEmail, secretKey);
    const originalEmail = bytes.toString(CryptoJS.enc.Utf8);
    return originalEmail;
  } catch (error) {
    console.error("Decryption error:", error);
    return null;
  }
}

// function encryptEmail(email) {
//   const cipher = crypto.createCipher('aes-256-cbc', secretKey);
//   let encrypted = cipher.update(email, 'utf8', 'hex');
//   encrypted += cipher.final('hex');
//   return encrypted;
// }

// function decryptEmail(encryptedEmail) {
//   try {
//     const bytes = CryptoJS.AES.decrypt(encryptedEmail, secretKey);
//     const originalEmail = bytes.toString(CryptoJS.enc.Utf8);
//     return originalEmail;
//   } catch (error) {
//     console.error("Decryption error:", error);
//     return null;
//   }
// }


router.post("/get_all_members_status", (req, res) => {
  const today = moment().format("YYYY-MM-DD HH:mm:ss");
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: "user_email is required" });
  }


  const query = `
    SELECT assigned_team_member, event_request_type, package_name, equipment_name
    FROM event_request 
    WHERE ? BETWEEN start_date AND end_date
  `;

  db.query(query, [today], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error", details: err });
    }

    if (results.length === 0) {
      console.log("No data found.");
      return res.json([]); // Return empty array if nothing found
    }

    const responseData = results.map(row => {
      let assignedMembers = [];

      try {
        // Parse JSON from DB safely
        assignedMembers = JSON.parse(row.assigned_team_member || "[]");
      } catch (error) {
        console.warn("Error parsing assigned_team_member JSON:", error);
      }

      return {
        assigned_team_member: assignedMembers,
        event_request_type: row.event_request_type,
        event_detail:
          row.event_request_type === "package"
            ? row.package_name
            : row.equipment_name,
      };
    });

    res.json(responseData);
  });
});


router.post("/get_members", (req, res) => {
  const { user_email } = req.body;
  const query = `
        SELECT * FROM team_member where owner_email = ?
    `;

  // Execute the query to fetch data from the database
  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching team members:", err);
      res.status(500).send("Database error");
      return;
    }
    res.json(results); // Send the fetched data as a JSON response
  });
});

router.post("/get_inactive_members", (req, res) => {
  const { user_email } = req.body;
  const query = `
        SELECT * FROM team_member where owner_email = ? 
    `;

  // Execute the query to fetch data from the database
  db.query(query, [user_email, "inactive"], (err, results) => {
    if (err) {
      console.error("Error fetching team members:", err);
      res.status(500).send("Database error");
      return;
    }
    res.json(results); // Send the fetched data as a JSON response
  });
});

router.post("/filtered_team_member", (req, res) => {
  const { user_email, start_date, end_date } = req.body;

  // Ensure input is provided
  if (!user_email || !start_date || !end_date) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  // This was causing the error - using formatted dates in SQL query
  // Instead of using formatDateTime for SQL, use standard date format for the query
  console.log("Filtering team members with params:", {
    user_email,
    start_date,
    end_date
  });

  // Query using the new event_team_member table
  const query = `
    SELECT DISTINCT etm.member_id
    FROM event_team_member etm
    JOIN event_request er ON etm.event_id = er.id
    WHERE er.receiver_email = ?
    AND (
      (etm.start_date <= ? AND etm.end_date >= ?) OR  /* Event contains the requested period */
      (etm.start_date >= ? AND etm.start_date <= ?) OR /* Event starts during requested period */
      (etm.end_date >= ? AND etm.end_date <= ?)      /* Event ends during requested period */
    )
  `;

  db.query(
    query,
    [user_email, end_date, start_date, start_date, end_date, start_date, end_date],
    (err, results) => {
      if (err) {
        console.error("Error fetching busy team members:", err);
        return res.status(500).json({ message: "Database error", error: err });
      }

      // Extract member IDs directly from query results
      const busyMemberIds = results.map(row => row.member_id);

      console.log(`Found ${busyMemberIds.length} busy team members:`, busyMemberIds);

      return res.status(200).json({
        assignedTeamMembers: busyMemberIds
      });
    }
  );
});



router.post("/add_members", (req, res) => {
  const {
    owner_email,
    member_name,
    member_profile_img,
    member_role,
  } = req.body;

  // Insert the new team member into the database
  const query = `
        INSERT INTO team_member (owner_email, member_name, member_profile_img, member_role) 
        VALUES (?, ?, ?, ?)
    `;

  db.query(
    query,
    [
      owner_email,
      member_name,
      member_profile_img,
      member_role,
    ],
    (err, result) => {
      if (err) {
        console.error("Error adding team member:", err);
        res.status(500).send("Database error");
        return;
      }
      res.status(201).json({ message: "Team member added successfully" });
    }
  );
});

router.delete("/delete_member", (req, res) => {
  const { member_id, owner_email } = req.body; // Expecting both member_id and owner_email in the request body

  // SQL query to delete the team member by member_id and owner_email
  const query = `
        DELETE FROM team_member 
        WHERE member_id = ? AND owner_email = ?
    `;

  db.query(query, [member_id, owner_email], (err, result) => {
    if (err) {
      console.error("Error deleting team member:", err);
      res.status(500).send("Database error");
      return;
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message:
          "Member not found or you do not have permission to delete this member",
      });
    }

    res.status(200).json({ message: "Team member deleted successfully" });
  });
});

router.put("/update_member/:id", (req, res) => {
  const { id } = req.params; // ID of the member to update
  const {
    member_name,
    member_profile_img,
    member_role,
    member_event_assignment,
    member_status,
  } = req.body;

  const query = `
        UPDATE team_member
        SET member_name = ?, member_profile_img = ?, member_role = ?, member_event_assignment = ?, member_status = ?
        WHERE id = ?
    `;

  db.query(
    query,
    [
      member_name,
      member_profile_img,
      member_role,
      member_event_assignment,
      member_status,
      id,
    ],
    (err, result) => {
      if (err) {
        console.error("Error updating team member:", err);
        res.status(500).send("Database error");
        return;
      }
      res.status(200).json({ message: "Team member updated successfully" });
    }
  );
});

router.put("/update_member", (req, res) => {
  const {
    member_id,
    owner_email,
    member_name,
    member_profile_img,
    member_role,
    member_event_assignment,
    member_status,
  } = req.body;

  // Ensure the provided owner_email matches the member's owner_email (foreign key validation)
  const query = `
        UPDATE team_member
        SET member_name = ?, member_profile_img = ?, member_role = ?, member_event_assignment = ?, member_status = ?
        WHERE member_id = ? AND owner_email = ?
    `;

  db.query(
    query,
    [
      member_name,
      member_profile_img,
      member_role,
      member_event_assignment,
      member_status,
      member_id,
      owner_email,
    ],
    (err, result) => {
      if (err) {
        console.error("Error updating team member:", err);
        res.status(500).send("Database error");
        return;
      }

      if (result.affectedRows === 0) {
        res
          .status(404)
          .json({ message: "Member not found or owner_email mismatch" });
        return;
      }

      res.status(200).json({ message: "Team member updated successfully" });
    }
  );
});

router.post("/team_status", (req, res) => {
  const { owner_email } = req.body;

  const query = `
    SELECT 
      COUNT(*) as total_members,
      SUM(CASE WHEN member_status = 'Active' THEN 1 ELSE 0 END) as active_members,
      SUM(CASE WHEN member_status = 'Inactive' THEN 1 ELSE 0 END) as inactive_members
    FROM team_member 
    WHERE owner_email = ?
  `;

  db.query(query, [owner_email], (err, results) => {
    if (err) {
      console.error("Error fetching team status:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    const status = results[0];
    res.json({
      total_members: status.total_members,
      active_members: status.active_members,
      inactive_members: status.inactive_members
    });
  });
});


// new routes 

// 1. Get all team members (active, assigned, and pending)
router.post("/get_all_members", (req, res) => {
  const { user_email } = req.body;
  const query = `
    SELECT owner_email, member_id, member_name, member_profile_img, member_role, 
           member_event_assignment, member_status, team_member_email, team_member_phone
    FROM team_member 
    WHERE owner_email = ?
  `;

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching all team members:", err);
      return res.status(500).json({ error: "Database error", details: err });
    }
    res.json(results);
  });
});

router.post("/invite_member", async (req, res) => {
  const {
    owner_email,
    member_name,
    member_profile_img,
    member_role,
    member_email,
    member_phone
  } = req.body;

  console.log("member profile image ", member_profile_img);

  try {
    // Step 1: Check if member already exists
    const checkQuery = `
      SELECT * FROM team_member
      WHERE owner_email = ? AND team_member_email = ?
    `;

    db.query(checkQuery, [owner_email, member_email], async (checkErr, checkResults) => {
      if (checkErr) {
        console.error("Error checking for existing team member:", checkErr);
        return res.status(500).json({ error: "Database error", details: checkErr });
      }

      if (checkResults.length > 0) {
        return res.status(400).json({
          error: "Team member with this email already exists",
          member: checkResults[0]
        });
      }

      // Step 2: Generate invitation token first
      const encryptedFrom = encryptEmail(owner_email);
      const encryptedTo = encryptEmail(member_email);
      const invitationToken = `${require('crypto').randomBytes(32).toString('hex')}__From__${encryptedFrom}__To__${encryptedTo}__`;



      // Step 3: Get owner info
      const ownerQuery = `
        SELECT user_name, business_name 
        FROM owner 
        WHERE user_email = ?
      `;

      const ownerResults = await new Promise((resolve, reject) => {
        db.query(ownerQuery, [owner_email], (err, results) => {
          if (err || results.length === 0) reject(err || new Error("Owner not found"));
          else resolve(results);
        });
      });

      const owner = ownerResults[0];
      const businessName = owner.business_name || "Photography Business";
      const ownerName = owner.user_name || "Business Owner";

      // Step 4: Insert the new team member directly with the token
      const insertQuery = `
        INSERT INTO team_member (
          owner_email, 
          member_name, 
          member_profile_img, 
          member_role, 
          team_member_email, 
          team_member_phone, 
          member_status,
          invitation_token,
          invitation_date
        ) 
        VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, NOW())
      `;

      const insertResult = await new Promise((resolve, reject) => {
        db.query(
          insertQuery,
          [
            owner_email,
            member_name,
            member_profile_img,
            member_role,
            member_email,
            member_phone,
            invitationToken
          ],
          (insertErr, result) => {
            if (insertErr) reject(insertErr);
            else resolve(result);
          }
        );
      });

      const member_id = insertResult.insertId;

      const accept_route = `${process.env.SERVER_URL}/team_members/confirmation/${member_id}`
      const reject_route = `${process.env.SERVER_URL}/team_members/rejection/${member_id}`
      // const invitationLink = `${process.env.SERVER_URL}/team_members/accept-invitation/${member_id}`;

      // Step 5: Send the invitation email
      const emailSent = await send_team_invitation_email(
        member_email,
        member_name,
        ownerName,
        businessName,
        member_role,
        accept_route,
        reject_route
        // member_id
      );

      if (!emailSent) {
        return res.status(500).json({ error: "Failed to send invitation email" });
      }

      // Return the data in the format expected by the client
      return res.status(201).json({
        message: "Invitation sent successfully",
        member_id: member_id,
        owner_email: owner_email,
        member_name: member_name,
        member_profile_img: member_profile_img,
        member_role: member_role,
        team_member_email: member_email,
        team_member_phone: member_phone,
        member_status: "Pending",
        invitation_token: invitationToken,
        invitation_date: new Date().toISOString()
      });
    });

  } catch (error) {
    console.error("Error in invite_member:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});


router.get("/accept-invitation/:member_id", async (req, res) => {
  const { member_id } = req.params;
  console.log("inside the accept invitation route")

  try {
    // Query for member info
    const memberQuery = "SELECT * FROM team_member WHERE member_id = ?";

    const [memberResults] = await new Promise((resolve, reject) => {
      db.query(memberQuery, [member_id], (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    if (!memberResults || memberResults.length === 0) {
      const file_path = "Member_not_found.html"
      const full_path = path.join(__dirname, file_path);
      try {
        const html = await fs.readFile(full_path, 'utf8');
        const renderedHtml = html.replace(/{{SERVER_URL}}/g, process.env.SERVER_URL);
        console.log("sending the rendered html");
        return res.send(renderedHtml);
      } catch (readErr) {
        console.error("Error reading confirmation template:", readErr);
        return res.status(500).send("Error loading confirmation page");
      }
      return;
    }

    const member = memberResults[0];
    const ownerEmail = member.owner_email;

    const ownerQuery = "SELECT user_name, business_name FROM owner WHERE user_email = ?";

    const [ownerResults] = await new Promise((resolve, reject) => {
      db.query(ownerQuery, [ownerEmail], (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    if (!ownerResults || ownerResults.length === 0) {
      console.error("Error fetching owner info");
      return res.status(500).send("Owner info not found");
    }

    const owner = ownerResults[0];
    const accept_route = `${process.env.SERVER_URL}/team_members/confirmation/${member_id}`
    const reject_route = `${process.env.SERVER_URL}/team_members/rejection/${member_id}`

    // Load and render the HTML template using async/await
    const filePath = path.join(__dirname, 'invitation_template.html');
    try {
      const html = await fs.readFile(filePath, 'utf8');

      const renderedHtml = html
        .replace(/{{business_name}}/g, owner.business_name || "Your Business")
        .replace(/{{member_email}}/g, member.team_member_email || "Team Member")
        .replace(/{{owner_name}}/g, owner.user_name || "Owner")
        .replace(/{{member_role}}/g, member.member_role || "Role")
        .replace(/{{member_id}}/g, member.member_id.toString())
        .replace(/{{accept_route}}/g, accept_route)
        .replace(/{{reject_route}}/g, reject_route)
        .replace(/{{SERVER_URL}}/g, process.env.SERVER_URL);

      console.log("rendered html", renderedHtml);
      return res.send(renderedHtml);
    } catch (readErr) {
      console.error('Error reading template:', readErr);
      return res.status(500).send('Error loading invitation page');
    }
  } catch (error) {
    console.error("Error in accept-invitation route:", error);
    return res.status(500).send("Server error");
  }
});

router.post("/check_email_exists", (req, res) => {
  const { email, owner_email } = req.body;
  if (!email || !owner_email) {
    return res.status(400).json({ error: "Missing email or owner_email" });
  }

  try {
    const sql = "SELECT 1 FROM team_member WHERE team_member_email = ? AND owner_email = ? LIMIT 1";
    const values = [email, owner_email];

    db.query(sql, values, (err, results) => {
      if (err) {
        console.error("Error checking team_member_email existence:", err);
        return res.status(500).json({ error: "Internal server error" });
      }

      const exists = results.length > 0;
      res.json({ exists });
    });
  } catch (e) {
    console.error("Checking the email fails", e);
  }
})


// confirm invitation 
router.get("/confirmation/:member_id", async (req, res) => {
  const { member_id } = req.params;

  if (!member_id) {
    return res.status(400).send("Member ID is required");
  }

  try {
    const checkStatusQuery = "SELECT member_status, owner_email, member_name, team_member_email FROM team_member WHERE member_id = ?";
    const [results] = await new Promise((resolve, reject) => {
      db.query(checkStatusQuery, [member_id], (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    if (!results || results.length === 0) {
      const file_path = "Member_not_found.html";
      const full_path = path.join(__dirname, file_path);
      try {
        const html = await fs.readFile(full_path, 'utf8');
        const renderedHtml = html.replace(/{{SERVER_URL}}/g, process.env.SERVER_URL);
        return res.send(renderedHtml);
      } catch (readErr) {
        console.error("Error reading confirmation template:", readErr);
        return res.status(500).send("Error loading confirmation page");
      }
      return;
    }

    const currentStatus = results[0]?.member_status;
    const ownerEmail = results[0]?.owner_email;
    const memberName = results[0]?.member_name;

    if (currentStatus === "Accepted") {
      const filePath = path.join(__dirname, "already_confirmed_template.html");
      try {
        const html = await fs.readFile(filePath, "utf8");
        const renderedHtml = html.replace(/{{status}}/g, currentStatus);
        return res.send(renderedHtml);
      } catch (readErr) {
        console.error("Error loading HTML file:", readErr);
        return res.status(500).send("Error loading confirmation page");
      }
      return;
    }

    if (currentStatus === "Rejected") {
      const filePath = path.join(__dirname, "already_rejected_template.html");
      try {
        const html = await fs.readFile(filePath, "utf8");
        const renderedHtml = html.replace(/{{status}}/g, currentStatus);
        return res.send(renderedHtml);
      } catch (readErr) {
        console.error("Error loading HTML file:", readErr);
        return res.status(500).send("Error loading confirmation page");
      }
      return;
    }

    // Step 2: Update to Accepted
    const updateQuery = "UPDATE team_member SET member_status = ? WHERE member_id = ?";
    await new Promise((resolve, reject) => {
      db.query(updateQuery, ["Accepted", member_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Get owner name for email notification
    const ownerQuery = "SELECT user_name FROM owner WHERE user_email = ?";
    const [ownerResults] = await new Promise((resolve, reject) => {
      db.query(ownerQuery, [ownerEmail], (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    if (ownerResults && ownerResults.length > 0) {
      const ownerName = ownerResults[0].user_name;
      // Send email notification to owner
      await send_owner_notification_email(ownerEmail, ownerName, memberName, "Accepted");
    }

    req.io.emit(`user_confirmation_updated_team_member`);

    const filePath = path.join(__dirname, 'confirmation_template.html'); // Match the correct file
    try {
      const html = await fs.readFile(filePath, 'utf8');
      const renderedHtml = html
        .replace(/{{status}}/g, "Accepted")
        .replace(/{{message}}/g, "You've been successfully added to the team! 🎉");

      return res.send(renderedHtml);
    } catch (readErr) {
      console.error("Error reading confirmation template:", readErr);
      return res.status(500).send("Error loading confirmation page");
    }
  } catch (error) {
    console.error("Error in confirmation route:", error);
    return res.status(500).send("Server error");
  }
});

// reject invitation
router.get("/rejection/:member_id", async (req, res) => {
  const { member_id } = req.params;

  if (!member_id) {
    return res.status(400).json({ error: "Member id not available" });
  }

  try {
    // Step 1: Check current member_status
    const checkStatusQuery = "SELECT member_status, owner_email, member_name FROM team_member WHERE member_id = ?";
    const [results] = await new Promise((resolve, reject) => {
      db.query(checkStatusQuery, [member_id], (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    if (!results || results.length === 0) {
      const file_path = "Member_not_found.html"
      const full_path = path.join(__dirname, file_path);

      try {
        const html = await fs.readFile(full_path, 'utf8');
        const renderedHtml = html.replace(/{{SERVER_URL}}/g, process.env.SERVER_URL);
        return res.send(renderedHtml);
      } catch (readErr) {
        console.error("Error reading confirmation template:", readErr);
        return res.status(500).send("Error loading confirmation page");
      }
      return;
    }

    const currentStatus = results[0]?.member_status;
    const ownerEmail = results[0]?.owner_email;
    const memberName = results[0]?.member_name;

    // If already confirmed or rejected, show proper UI
    if (currentStatus === "Accepted") {
      const filePath = path.join(__dirname, "already_confirmed_template.html"); // Make sure filename is correct

      try {
        const html = await fs.readFile(filePath, "utf8");
        const renderedHtml = html.replace(/{{status}}/g, currentStatus);
        return res.send(renderedHtml);
      } catch (readErr) {
        console.error("Error loading HTML file:", readErr);
        return res.status(500).send("Error loading confirmation page");
      }
    }

    // Step 2: Update to Rejected
    const updateQuery = `
      UPDATE team_member 
      SET member_status = 'Rejected', invitation_token = NULL 
      WHERE member_id = ?
    `;

    await new Promise((resolve, reject) => {
      db.query(updateQuery, [member_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Get owner name for email notification
    const ownerQuery = "SELECT user_name FROM owner WHERE user_email = ?";
    const [ownerResults] = await new Promise((resolve, reject) => {
      db.query(ownerQuery, [ownerEmail], (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    if (ownerResults && ownerResults.length > 0) {
      const ownerName = ownerResults[0].user_name;
      // Send email notification to owner
      await send_owner_notification_email(ownerEmail, ownerName, memberName, "Rejected");
    }

    req.io.emit(`user_confirmation_updated_team_member`);

    // Step 3: Load HTML template and respond
    const filePath = path.join(__dirname, "confirmation_template.html"); // Same template file
    try {
      const html = await fs.readFile(filePath, "utf8");
      const renderedHtml = html
        .replace(/{{status}}/g, "Rejected")
        .replace(/{{message}}/g, "You've successfully rejected the invitation.");

      return res.send(renderedHtml);
    } catch (readErr) {
      console.error("Error loading HTML file:", readErr);
      return res.status(500).send("Error loading confirmation page");
    }
  } catch (error) {
    console.error("Error in rejection route:", error);
    return res.status(500).send("Server error");
  }
});



// New endpoint to get invitation details
router.post("/invitation-details", (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Invitation token is required" });
  }

  // Extract emails from token format: randomString__From__encryptedFromEmail__To__encryptedToEmail__
  const tokenParts = token.split('__From__');
  if (tokenParts.length !== 2) {
    return res.status(400).json({ error: "Invalid token format" });
  }

  const emailParts = tokenParts[1].split('__To__');
  if (emailParts.length !== 2) {
    return res.status(400).json({ error: "Invalid token format" });
  }

  const encryptedOwnerEmail = emailParts[0];
  const encryptedMemberEmail = emailParts[1].replace('__', '');

  try {
    const ownerEmail = decryptEmail(encryptedOwnerEmail);

    // Get invitation details from the database
    const query = `
      SELECT t.member_name, t.member_role, o.business_name, o.user_name
      FROM team_member t
      JOIN owner o ON t.owner_email = o.user_email
      WHERE t.invitation_token = ? AND t.owner_email = ?
    `;

    db.query(query, [token, ownerEmail], (err, results) => {
      if (err) {
        console.error("Error fetching invitation details:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Invitation not found or expired" });
      }

      const invitation = results[0];

      res.json({
        memberName: invitation.member_name,
        memberRole: invitation.member_role,
        businessName: invitation.business_name,
        ownerName: invitation.user_name
      });
    });
  } catch (error) {
    console.error("Error processing invitation details:", error);
    return res.status(500).json({ error: "Failed to process invitation" });
  }
});


// 6. Accept team member invitation - API endpoint
// router.post("/accept-invitation", (req, res) => {
//   const { token } = req.body;

//   if (!token) {
//     return res.status(400).json({ error: "Invitation token is required" });
//   }

//   const query = `
//     SELECT * FROM team_member
//     WHERE invitation_token = ?
//   `;

//   db.query(query, [token], (err, results) => {
//     if (err) {
//       console.error("Error checking invitation token:", err);
//       return res.status(500).json({ error: "Database error" });
//     }

//     if (results.length === 0) {
//       return res.status(404).json({ error: "Invalid or expired invitation token" });
//     }

//     const member = results[0];

//     // Update the member status to Active
//     const updateQuery = `
//       UPDATE team_member
//       SET member_status = 'Active', invitation_token = NULL, confirmation_date = NOW()
//       WHERE member_id = ?
//     `;

//     db.query(updateQuery, [member.member_id], (updateErr) => {
//       if (updateErr) {
//         console.error("Error accepting invitation:", updateErr);
//         return res.status(500).json({ error: "Failed to accept invitation" });
//       }

//       // Return success with member details
//       res.json({
//         message: "Invitation accepted successfully",
//         member: {
//           id: member.member_id,
//           name: member.member_name,
//           role: member.member_role,
//           email: member.team_member_email
//         }
//       });
//     });
//   });
// });

router.post("/photographers", (req, res) => {
  const { query, user_email } = req.body;

  if (!query || query.trim().length < 3) {
    return res.status(400).json({ error: "Search query must be at least 3 characters long" });
  }

  const searchQuery = `
    SELECT client_id, user_name, user_email, business_name, business_address, 
           mobile_number, user_profile_image_base64 
    FROM owner 
    WHERE (
      LOWER(user_name) LIKE ? OR 
      LOWER(user_email) LIKE ? OR 
      LOWER(business_name) LIKE ? OR 
      LOWER(business_address) LIKE ? OR 
      mobile_number LIKE ?
    )
    AND user_email != ?
    LIMIT 10
  `;

  const searchParam = `%${query.toLowerCase()}%`;

  db.query(
    searchQuery,
    [searchParam, searchParam, searchParam, searchParam, searchParam, user_email],
    (err, results) => {
      if (err) {
        console.error("Error searching photographers:", err);
        return res.status(500).json({ error: "Database error", details: err });
      }

      const sanitizedResults = results.map(user => ({
        user_id: user.user_id,
        user_name: user.user_name,
        user_email: user.user_email,
        business_name: user.business_name,
        business_address: user.business_address,
        mobile_number: user.mobile_number,
        user_profile_image_base64: user.user_profile_image_base64
      }));

      res.json(sanitizedResults);
    }
  );
});

// Create a new endpoint to handle team member assignment
router.post("/add-team-members", async (req, res) => {
  console.log("req.body", req.body);
  const { user_email, team_members, event_id, socket_id } = req.body;

  if (!user_email || !team_members || !event_id) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  try {
    // Get event information
    const eventQuery = "SELECT * FROM event_request WHERE id = ?";
    const [eventResult] = await db.promise().query(eventQuery, [event_id]);

    if (eventResult.length === 0) {
      return res.status(404).json({ message: "Event not found" });
    }

    const event = eventResult[0];

    // Get owner information for emails
    const ownerQuery = "SELECT user_name, business_name FROM owner WHERE user_email = ?";
    const [ownerResult] = await db.promise().query(ownerQuery, [user_email]);

    if (ownerResult.length === 0) {
      return res.status(404).json({ message: "Owner not found" });
    }

    const owner = ownerResult[0];

    // Create user-specific event names for socket events
    const progressEventName = `email_sending_progress_for_${user_email}`;
    const completeEventName = `email_sending_complete_for_${user_email}`;

    // Begin transaction
    await db.promise().beginTransaction();

    // Delete any existing assignments for this event (to handle updates)
    await db.promise().query(
      "DELETE FROM event_team_member WHERE event_id = ?",
      [event_id]
    );

    // Update event status to "Waiting on Team"
    await db.promise().query(
      "UPDATE event_request SET event_status = 'Waiting on Team' WHERE id = ?",
      [event_id]
    );

    // Add new assignments with 'Pending' status
    for (let i = 0; i < team_members.length; i++) {
      const member = team_members[i];
      const memberId = member.member_id;

      // Insert with pending confirmation status
      await db.promise().query(
        `INSERT INTO event_team_member 
         (event_id, member_id, assigned_by_email, start_date, end_date, role_in_event, confirmation_status)
         VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
        [event_id, memberId, user_email, event.start_date, event.end_date, 'Team Member']
      );

      // Send confirmation email to team member
      // We need to get the team member's email
      const [memberData] = await db.promise().query(
        "SELECT member_name, team_member_email FROM team_member WHERE member_id = ?",
        [memberId]
      );

      let event_title;

      if (event.event_request_type === 'package') {
        event_title = event.package_name;
      } else if (event.event_request_type === 'service') {
        event_title = event.service_name;
      } else if (event.event_request_type === 'equipment') {
        event_title = event.equipment_name || event.event_name;
      }

      if (memberData.length > 0 && memberData[0].team_member_email) {
        // Emit progress update via socket.io before sending the email - using user-specific event name
        if (socket_id) {
          req.io.to(socket_id).emit(progressEventName, {
            emailIndex: i,
            totalEmails: team_members.length,
            eventId: event_id,
            memberName: memberData[0].member_name,
            memberEmail: memberData[0].team_member_email
          });
        }

        // Add a small delay to simulate email sending process (useful for UI feedback)
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Send confirmation email
        await send_team_event_confirmation_email(
          memberData[0].team_member_email,
          memberData[0].member_name,
          event_id,
          event_title,
          event.start_date,
          event.end_date,
          event.location,
          owner.user_name,
          owner.business_name
        );
      }
    }

    // Commit transaction
    await db.promise().commit();

    // Emit final socket event for UI update - using user-specific event name
    if (socket_id) {
      req.io.to(socket_id).emit(completeEventName, {
        eventId: event_id,
        status: 'Waiting on Team',
        teamCount: team_members.length
      });
    }

    // Also emit event for team assignment (used by other components)
    req.io.emit(`event_team_assigned_${event_id}`, {
      event_id,
      status: 'Waiting on Team',
      team_count: team_members.length
    });

    res.json({ message: "Team members assigned successfully", status: "Waiting on Team" });
  } catch (error) {
    // Rollback on error
    try {
      await db.promise().rollback();
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }

    console.error("Error assigning team members:", error);
    res.status(500).json({ message: "Failed to assign team members", error: error.message });
  }
});

// Add endpoints to handle team member confirmations
router.get("/event-confirmation/:event_id/:member_email/:action", async (req, res) => {
  const { event_id, member_email, action } = req.params;

  if (!event_id || !member_email || !['accept', 'reject'].includes(action)) {
    return res.status(400).send("Invalid request parameters");
  }

  try {
    // Get member ID from email
    const [memberData] = await db.promise().query(
      "SELECT member_id, member_name FROM team_member WHERE team_member_email = ?",
      [member_email]
    );

    if (memberData.length === 0) {
      return res.status(404).send("Team member not found");
    }

    const member_id = memberData[0].member_id;
    const member_name = memberData[0].member_name;

    // First, check if this member has already responded to this event
    const [existingResponse] = await db.promise().query(
      "SELECT confirmation_status FROM event_team_member WHERE event_id = ? AND member_id = ?",
      [event_id, member_id]
    );

    if (existingResponse.length > 0 && existingResponse[0].confirmation_status !== 'Pending') {
      // Member has already responded, show appropriate template based on their existing response
      const currentStatus = existingResponse[0].confirmation_status;

      // Get event details for the template
      const [eventDetails] = await db.promise().query(
        "SELECT * FROM event_request WHERE id = ?",
        [event_id]
      );

      if (eventDetails.length === 0) {
        return res.status(404).send("Event not found");
      }

      const event = eventDetails[0];
      const startDate = formatDateTime(event.start_date);
      const endDate = formatDateTime(event.end_date);

      // Choose the appropriate template
      let templateFile;
      if (currentStatus === 'Accepted') {
        templateFile = 'already_confirmed_template.html';
      } else if (currentStatus === 'Rejected') {
        templateFile = 'already_rejected_template.html';
      }

      try {
        // Read the template file
        const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');

        let event_title;

        if (event.event_request_type === 'package') {
          event_title = event.package_name;
        } else if (event.event_request_type === 'service') {
          event_title = event.service_name;
        } else if (event.event_request_type === 'equipment') {
          event_title = event.equipment_name || event.event_name;
        }
        // Replace placeholders with actual data
        const renderedHtml = template
          .replace(/{{event_title}}/g, event_title || 'Event')
          .replace(/{{event_start}}/g, startDate)
          .replace(/{{event_end}}/g, endDate)
          .replace(/{{event_location}}/g, event.location || 'Not specified');

        return res.send(renderedHtml);
      } catch (readError) {
        console.error(`Error reading template: ${readError.message}`);
        return res.status(500).send(`You have already ${currentStatus.toLowerCase()} this event.`);
      }
    }

    // If we reach here, the member hasn't responded yet, so process their response

    // Update confirmation status
    const status = action === 'accept' ? 'Accepted' : 'Rejected';

    await db.promise().query(
      "UPDATE event_team_member SET confirmation_status = ?, confirmation_date = NOW() WHERE event_id = ? AND member_id = ?",
      [status, event_id, member_id]
    );

    // Get event info
    const [eventData] = await db.promise().query(
      "SELECT title, receiver_email FROM event_request WHERE id = ?",
      [event_id]
    );

    if (eventData.length > 0) {
      const event = eventData[0];

      // Get owner info
      const [ownerData] = await db.promise().query(
        "SELECT user_name FROM owner WHERE user_email = ?",
        [event.receiver_email]
      );

      // Check if all team members have responded
      const [pendingMembers] = await db.promise().query(
        "SELECT COUNT(*) AS pending_count FROM event_team_member WHERE event_id = ? AND confirmation_status = 'Pending'",
        [event_id]
      );

      // Check if any members declined
      const [declinedMembers] = await db.promise().query(
        "SELECT COUNT(*) AS declined_count FROM event_team_member WHERE event_id = ? AND confirmation_status = 'Rejected'",
        [event_id]
      );

      let newEventStatus = 'Waiting on Team';

      // If no pending members, update event status
      if (pendingMembers[0].pending_count === 0) {
        newEventStatus = declinedMembers[0].declined_count > 0 ? 'Team Incomplete' : 'Accepted';

        // Update event status
        await db.promise().query(
          "UPDATE event_request SET event_status = ? WHERE id = ?",
          [newEventStatus, event_id]
        );

        // Get event details to notify sender if all team members have confirmed
        const [eventDetails] = await db.promise().query(
          "SELECT * FROM event_request WHERE id = ?",
          [event_id]
        );

        if (eventDetails.length > 0 && newEventStatus === 'Accepted') {
          const eventData = eventDetails[0];

          // Send confirmation email to the sender (client) only after all team members confirmed
          try {
            // Import the email module if needed
            const { send_event_confirmation_email } = require('../modules/send_server_email');

            // Format the event title based on event type
            let eventTitle = '';
            if (eventData.event_request_type === 'package') {
              eventTitle = eventData.package_name;
            } else if (eventData.event_request_type === 'equipment') {
              eventTitle = eventData.equipment_name || eventData.event_name;
            } else if (eventData.event_request_type === 'service') {
              eventTitle = eventData.service_name;
            }

            // Get owner name for the email
            const [ownerInfo] = await db.promise().query(
              "SELECT user_name FROM owner WHERE user_email = ?",
              [eventData.receiver_email]
            );

            const ownerName = ownerInfo.length > 0 ? ownerInfo[0].user_name : "Event Organizer";

            // Send the confirmation email to sender
            await send_event_confirmation_email(
              eventData.sender_email,
              eventTitle,
              formatDateTime(eventData.start_date),
              formatDateTime(eventData.end_date),
              eventData.requirements || "No specific requirements",
              eventData.location || "Location not specified",
              ownerName
            );

            console.log(`Confirmation email sent to sender ${eventData.sender_email} after all team members confirmed`);
          } catch (emailError) {
            console.error("Error sending confirmation email to sender:", emailError);
          }
        }
      }

      // Emit socket event for real-time updates
      await notifyEventConfirmationUpdate(req.io, event_id, event.receiver_email);

    }

    // Render confirmation page using HTML file templates
    const templateFile = action === 'accept'
      ? 'event_confirmation_accepted.html'
      : 'event_confirmation_declined.html';

    try {
      const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');
      res.send(template);
    } catch (readError) {
      console.error(`Error reading confirmation template ${templateFile}:`, readError);

      // Fallback template if file not found
      const fallbackHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; text-align: center;">
          <h2 style="color: ${action === 'accept' ? '#22C55E' : '#EF4444'};">
            ${action === 'accept' ? 'Event Accepted' : 'Event Rejected'}
          </h2>
          <p>You have ${action === 'accept' ? 'accepted' : 'rejected'} the event assignment.</p>
          <p>The organizer has been notified of your response.</p>
          <p>You may close this window.</p>
        </div>
      `;

      res.send(fallbackHtml);
    }

  } catch (error) {
    console.error("Error processing confirmation:", error);
    res.status(500).send("An error occurred while processing your response");
  }
});

// check confirmation status for all team members
router.post('/check-confirmation-status', async (req, res) => {
  const { ids } = req.body;

  // Validate that ids is an array
  if (!Array.isArray(ids)) {
    console.error('Invalid input: ids is not an array', ids);
    return res.status(400).json({ error: 'Invalid input: ids must be an array' });
  }

  const statuses = [];

  try {
    for (const id of ids) {
      const query = 'SELECT confirmation_status FROM event_team_member WHERE event_id = ?';
      const [result] = await db.execute(query, [id]);
      statuses.push(result.length > 0 ? result[0].confirmation_status : null);
    }

    console.log("this is the status to send ", statuses)
    res.json(
      statuses.includes('pending')
        ? { status: 'pending' }
        : { status: 'no_pending', statuses }
    );
  } catch (error) {
    console.error('Error in /check-confirmation-status:', error.message, error.stack);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add an endpoint to check event team confirmation status
router.post("/check-event-team-status", async (req, res) => {
  const { event_id } = req.body;

  if (!event_id) {
    return res.status(400).json({ message: "Event ID is required" });
  }

  try {
    // Get all team members for this event with their confirmation status
    const query = `
      SELECT tm.member_id, tm.member_name, tm.team_member_email, 
             etm.confirmation_status, etm.role_in_event
      FROM event_team_member etm
      JOIN team_member tm ON etm.member_id = tm.member_id
      WHERE etm.event_id = ?
    `;

    const [members] = await db.promise().query(query, [event_id]);

    // Get event status
    const [eventData] = await db.promise().query(
      "SELECT event_status FROM event_request WHERE id = ?",
      [event_id]
    );

    const eventStatus = eventData.length > 0 ? eventData[0].event_status : 'Unknown';

    // Count by status
    const statusCounts = {
      total: members.length,
      confirmed: members.filter(m => m.confirmation_status === 'Accepted').length,
      declined: members.filter(m => m.confirmation_status === 'Rejected').length,
      pending: members.filter(m => m.confirmation_status === 'Pending').length
    };

    res.json({
      event_id,
      event_status: eventStatus,
      members,
      status_counts: statusCounts
    });

  } catch (error) {
    console.error("Error checking event team status:", error);
    res.status(500).json({ message: "Failed to check team status", error: error.message });
  }
});

// Add a new endpoint to get team members assignment statistics
router.post("/team_assignment_stats", async (req, res) => {
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: "user_email is required" });
  }

  try {
    // Step 1: Get all team members for this owner
    const [teamMembers] = await db.promise().query(
      "SELECT member_id, member_name,member_status FROM team_member WHERE owner_email = ? AND member_status = 'Active'",
      [user_email]
    );

    if (teamMembers.length === 0) {
      return res.json({
        total_members: 0,
        assigned_members: 0,
        unassigned_members: 0,
        assigned_percentage: 0,
        members: []
      });
    }

    // Step 2: Get all current events with assigned team members
    const [events] = await db.promise().query(
      `SELECT id, assigned_team_member, event_request_type, package_name, equipment_name, service_name, event_name, start_date, end_date, client_name
       FROM event_request 
       WHERE receiver_email = ? AND event_status NOT IN ('Cancelled', 'Completed', 'Rejected')`,
      [user_email]
    );

    // Set to track assigned member IDs
    const assignedMemberIds = new Set();

    // Map to store assignment details
    const memberAssignments = new Map();

    // Process each event to extract assigned members
    events.forEach(event => {
      let assignedMembers = [];
      try {
        assignedMembers = JSON.parse(event.assigned_team_member || "[]");
      } catch (error) {
        console.warn("Error parsing assigned_team_member JSON:", error);
      }

      // Get event title based on event type
      let eventTitle = '';
      if (event.event_request_type === 'package') {
        eventTitle = event.package_name;
      } else if (event.event_request_type === 'equipment') {
        eventTitle = event.equipment_name || event.event_name;
      } else if (event.event_request_type === 'service') {
        eventTitle = event.service_name;
      }

      // Add each member to the assigned set and record assignment details
      assignedMembers.forEach(memberId => {
        if (memberId) {
          assignedMemberIds.add(memberId);

          if (!memberAssignments.has(memberId)) {
            memberAssignments.set(memberId, []);
          }

          memberAssignments.get(memberId).push({
            event_id: event.id,
            event_title: eventTitle,
            start_date: event.start_date,
            end_date: event.end_date,
            client_name: event.client_name
          });
        }
      });
    });

    // Prepare response data
    const assignedCount = assignedMemberIds.size;
    const totalCount = teamMembers.length;
    const unassignedCount = totalCount - assignedCount;
    const assignedPercentage = totalCount > 0 ? Math.round((assignedCount / totalCount) * 100) : 0;

    // Prepare detailed member data
    const memberDetails = teamMembers.map(member => {
      const isAssigned = assignedMemberIds.has(member.member_id);
      return {
        member_id: member.member_id,
        member_name: member.member_name,
        status: isAssigned ? 'Assigned' : 'Available',
        assignments: memberAssignments.get(member.member_id) || []
      };
    });

    res.json({
      total_members: totalCount,
      assigned_members: assignedCount,
      unassigned_members: unassignedCount,
      assigned_percentage: assignedPercentage,
      members: memberDetails
    });

  } catch (error) {
    console.error("Error fetching team assignment stats:", error);
    res.status(500).json({
      error: "Failed to fetch team assignment statistics",
      details: error.message
    });
  }
});

router.post("/get-event-team-members", (req, res) => {
  const { event_id } = req.body;

  if (!event_id) {
    return res.status(400).json({ message: "Event ID is required" });
  }

  console.log("get-event-team- members called with event_id:", event_id);

  // First check if the event exists
  const eventQuery = "SELECT id, assigned_team_member FROM event_request WHERE id = ?";

  db.query(eventQuery, [event_id], (eventErr, eventResults) => {
    if (eventErr) {
      console.error("Error checking event existence:", eventErr);
      return res.status(500).json({ message: "Database error", error: eventErr });
    }

    if (eventResults.length === 0) {
      console.log("Event not found with ID:", event_id);
      return res.status(404).json({ message: "Event not found" });
    }

    const event = eventResults[0];
    console.log("Found event:", event);

    // Try to parse assigned_team_member if it exists
    let assignedTeamMembers = [];
    try {
      // This handles the old format where team members were stored in a JSON array
      if (event.assigned_team_member) {
        if (typeof event.assigned_team_member === 'string') {
          assignedTeamMembers = JSON.parse(event.assigned_team_member);
        } else {
          assignedTeamMembers = event.assigned_team_member;
        }

        if (!Array.isArray(assignedTeamMembers)) {
          assignedTeamMembers = [assignedTeamMembers];
        }
      }
    } catch (parseError) {
      console.error("Error parsing assigned_team_member:", parseError);
    }

    // If we have assigned team members in the old format, fetch them directly
    if (assignedTeamMembers.length > 0) {
      console.log("Using legacy format for team members:", assignedTeamMembers);

      // Query to get team member details
      const memberQuery = `
        SELECT member_id, member_name, member_profile_img, team_member_email
        FROM team_member 
        WHERE member_id IN (?)
      `;

      db.query(memberQuery, [assignedTeamMembers], (memberErr, memberResults) => {
        if (memberErr) {
          console.error("Error fetching team member details:", memberErr);
          return res.status(500).json({ message: "Database error", error: memberErr });
        }

        // Add a default confirmation status since it's not stored in the old format
        const resultWithStatus = memberResults.map(member => ({
          ...member,
          confirmation_status: "Accepted", // Default status
          role_in_event: "Team Member" // Default role
        }));

        console.log("Returning legacy team members:", resultWithStatus);
        return res.json(resultWithStatus);
      });
    } else {
      // Try to fetch from the new event_team_member table
      console.log("Checking event_team_member table for event_id:", event_id);

      // Check if event_team_member table exists
      db.query("SHOW TABLES LIKE 'event_team_member'", (tableErr, tableResults) => {
        if (tableErr) {
          console.error("Error checking table existence:", tableErr);
          return res.status(500).json({ message: "Database error", error: tableErr });
        }

        if (tableResults.length === 0) {
          console.log("event_team_member table doesn't exist, returning empty array");
          return res.json([]);
        }

        // Table exists, query from it
        const query = `
          SELECT etm.member_id, etm.confirmation_status, etm.role_in_event,
                 tm.member_name, tm.member_profile_img, tm.team_member_email
          FROM event_team_member etm
          JOIN team_member tm ON etm.member_id = tm.member_id
          WHERE etm.event_id = ?
        `;

        db.query(query, [event_id], (err, results) => {
          if (err) {
            console.error("Error fetching event team members:", err);
            return res.status(500).json({ message: "Failed to fetch team members", error: err });
          }

          console.log("Successfully fetched team members from event_team_member table:", results);
          res.json(results);
        });
      });
    }
  });
});

router.post("/business_related_details", async (req, res) => {
  const { member_id } = req.body;

  if (!member_id) {
    return res.status(400).json({ error: "Member ID is required" });
  }

  try {
    // Get team member info
    const memberQuery = "SELECT member_name, member_role, team_member_email FROM team_member WHERE member_id = ?";
    const [memberResult] = await db.promise().query(memberQuery, [member_id]);
    
    if (memberResult.length === 0) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const memberInfo = memberResult[0];

    // Get all accepted events for this team member
    const eventsQuery = `
      SELECT etm.*, er.* 
      FROM event_team_member etm
      JOIN event_request er ON etm.event_id = er.id
      WHERE etm.member_id = ? AND etm.confirmation_status = 'Accepted'
      ORDER BY er.start_date DESC
    `;
    
    const [eventsResult] = await db.promise().query(eventsQuery, [member_id]);
    
    // Format event data for better frontend consumption
    const formattedEvents = eventsResult.map(event => {
      let eventTitle;
      if (event.event_request_type === 'package') {
        eventTitle = event.package_name;
      } else if (event.event_request_type === 'service') {
        eventTitle = event.service_name;
      } else if (event.event_request_type === 'equipment') {
        eventTitle = event.equipment_name || event.event_name;
      }
      
      return {
        event_id: event.event_id,
        title: eventTitle,
        type: event.event_request_type,
        start_date: event.start_date,
        end_date: event.end_date,
        formatted_start: formatDateTime(event.start_date),
        formatted_end: formatDateTime(event.end_date),
        location: event.location,
        client_name: event.client_name,
        client_email: event.sender_email,
        requirements: event.requirements,
        confirmation_date: event.confirmation_date,
        role_in_event: event.role_in_event,
        status: event.event_status,
        is_completed: ['Completed', 'Event Expired'].includes(event.event_status)
      };
    });

    // Get stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total_events,
        SUM(CASE WHEN er.event_status = 'Completed' THEN 1 ELSE 0 END) as completed_events,
        SUM(CASE WHEN er.event_status IN ('Accepted', 'Waiting on Team') THEN 1 ELSE 0 END) as upcoming_events,
        MIN(er.start_date) as first_event_date
      FROM event_team_member etm
      JOIN event_request er ON etm.event_id = er.id
      WHERE etm.member_id = ? AND etm.confirmation_status = 'Accepted'
    `;
    
    const [statsResult] = await db.promise().query(statsQuery, [member_id]);
    const stats = statsResult[0];
    
    // Calculate days as team member
    let daysAsTeamMember = 0;
    if (stats.first_event_date) {
      const firstDate = new Date(stats.first_event_date);
      const today = new Date();
      daysAsTeamMember = Math.floor((today - firstDate) / (1000 * 60 * 60 * 24));
    }
    
    // Return comprehensive data
    res.status(200).json({
      member: memberInfo,
      stats: {
        total_events: stats.total_events || 0,
        completed_events: stats.completed_events || 0,
        upcoming_events: stats.upcoming_events || 0,
        days_as_team_member: daysAsTeamMember
      },
      upcoming_events: formattedEvents.filter(e => !e.is_completed),
      past_events: formattedEvents.filter(e => e.is_completed),
      all_events: formattedEvents
    });
    
  } catch (error) {
    console.error("Error fetching business details:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// Route to check for events that have ended and update their status
router.get("/check-past-events/:user_email", async (req, res) => {
  const { user_email } = req.params;

  if (!user_email) {
    return res.status(400).json({ error: "User email is required" });
  }

  try {
    const now = new Date();

    // Find events where:
    // 1. The user is the receiver
    // 2. End date has passed
    // 3. Status is not already "Completed" or "Rejected"
    const query = `
      UPDATE event_request 
      SET 
        event_status = CASE 
          WHEN event_status = 'Accepted' THEN 'Completed'
          WHEN event_status != 'Rejected' THEN 'Event Expired'
          ELSE event_status
        END
      WHERE 
        receiver_email = ? 
        AND end_date < ?
        AND event_status NOT IN ('Completed', 'Event Expired', 'Rejected')
    `;

    const [result] = await db.promise().query(query, [user_email, now]);

    // Check if any rows were affected
    const updated = result.affectedRows > 0;

    // If any events were updated, emit a socket event
    if (updated) {
      req.io.emit(`event-status-update-${user_email}`);
    }

    return res.json({ updated, count: result.affectedRows });

  } catch (error) {
    console.error("Error checking past events:", error);
    return res.status(500).json({ error: "Database error", details: error.message });
  }
});

module.exports = router;
