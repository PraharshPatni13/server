const express = require("express");
const CryptoJS = require('crypto-js');
const router = express.Router();
const mysql = require("mysql2");
const moment = require("moment");
const fs = require('fs').promises;
const path = require('path');


require('dotenv').config();
const { send_team_invitation_email, send_owner_notification_email, send_team_event_confirmation_email } = require('../modules/send_server_email');

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

  // Format dates properly to ensure consistent comparison
  const formattedStartDate = formatDateTime(start_date);
  const formattedEndDate = formatDateTime(end_date);

  console.log("Filtering team members with params:", { 
    user_email, 
    formatted_start: formattedStartDate, 
    formatted_end: formattedEndDate 
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
    [user_email, formattedEndDate, formattedStartDate, formattedStartDate, formattedEndDate, formattedStartDate, formattedEndDate],
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

      const invitationLink = `${process.env.SERVER_URL}/team_members/accept-invitation/${member_id}`;

      // Step 5: Send the invitation email
      const emailSent = await send_team_invitation_email(
        member_email,
        member_name,
        ownerName,
        businessName,
        member_role,
        invitationLink,
        member_id
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


router.get("/accept-invitation/:member_id", (req, res) => {
  const { member_id } = req.params;

  const memberQuery = "SELECT * FROM team_member WHERE member_id = ?";

  db.query(memberQuery, [member_id], (memberErr, memberResults) => {
    if (memberResults.length === 0) {
      const file_path = "Member_not_found.html"
      const full_path = path.join(__dirname, file_path);
      fs.readFile(full_path, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error("Error reading confirmation template:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{SERVER_URL}}/g, process.env.SERVER_URL)

        return res.send(renderedHtml);
      });
      return;
    }

    const member = memberResults[0];
    const ownerEmail = member.owner_email;

    const ownerQuery = "SELECT user_name, business_name FROM owner WHERE user_email = ?";

    db.query(ownerQuery, [ownerEmail], (ownerErr, ownerResults) => {
      if (ownerErr || ownerResults.length === 0) {
        console.error("Error fetching owner info:", ownerErr);
        return res.status(500).send("Owner info not found");
      }

      const owner = ownerResults[0];
      const accept_route = `${process.env.SERVER_URL}/team_members/confirmation/${member_id}`
      const reject_route = `${process.env.SERVER_URL}/team_members/rejection/${member_id}`

      // 🧾 Load and render the HTML template
      const filePath = path.join(__dirname, 'invitation_template.html');
      fs.readFile(filePath, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error('Error reading template:', readErr);
          return res.status(500).send('Error loading invitation page');
        }


        const renderedHtml = html
          .replace(/{{business_name}}/g, owner.business_name || "Your Business")
          .replace(/{{member_email}}/g, member.team_member_email || "Team Member")
          .replace(/{{owner_name}}/g, owner.user_name || "Owner")
          .replace(/{{member_role}}/g, member.member_role || "Role")
          .replace(/{{member_id}}/g, member.member_id.toString())
          .replace(/{{accept_route}}/g, accept_route)
          .replace(/{{reject_route}}/g, reject_route)
          .replace(/{{SERVER_URL}}/g, process.env.SERVER_URL);

        res.send(renderedHtml);
      });
    });
  });
});


// confirm invitation 
router.get("/confirmation/:member_id", (req, res) => {
  const { member_id } = req.params;

  if (!member_id) {
    return res.status(400).send("Member ID is required");
  }

  const checkStatusQuery = "SELECT member_status, owner_email, member_name, team_member_email FROM team_member WHERE member_id = ?";
  db.query(checkStatusQuery, [member_id], (checkErr, results) => {
    if (checkErr) {
      console.error("Error checking member status:", checkErr);
      return res.status(500).send("Database error");
    }

    if (results.length === 0) {
      const file_path = "Member_not_found.html"
      const full_path = path.join(__dirname, file_path);
      fs.readFile(full_path, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error("Error reading confirmation template:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{SERVER_URL}}/g, process.env.SERVER_URL)

        return res.send(renderedHtml);
      });
      return;
    }

    const currentStatus = results[0]?.member_status;
    const ownerEmail = results[0]?.owner_email;
    const memberName = results[0]?.member_name;

    if (currentStatus === "Accepted") {
      const filePath = path.join(__dirname, "already_confirmed_template.html");
      fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) {
          console.error("Error loading HTML file:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, currentStatus)

        return res.send(renderedHtml);
      });
      return;
    }
    if (currentStatus === "Rejected") {
      const filePath = path.join(__dirname, "already_rejected_template.html");
      fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) {
          console.error("Error loading HTML file:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, currentStatus)
        // .replace(/{{message}}/g, msg);

        return res.send(renderedHtml);
      });
      return;
    }

    // Step 2: Update to Accepted
    const updateQuery = "UPDATE team_member SET member_status = ? WHERE member_id = ?";
    db.query(updateQuery, ["Accepted", member_id], async (updateErr, result) => {
      if (updateErr) {
        console.error("Error updating member status:", updateErr);
        return res.status(500).send("Could not update member to confirmed");
      }

      // Get owner name for email notification
      const ownerQuery = "SELECT user_name FROM owner WHERE user_email = ?";
      db.query(ownerQuery, [ownerEmail], async (ownerErr, ownerResults) => {
        if (!ownerErr && ownerResults.length > 0) {
          const ownerName = ownerResults[0].user_name;

          // Send email notification to owner
          await send_owner_notification_email(ownerEmail, ownerName, memberName, "Accepted");
        } else {
          console.error("Error fetching owner details for email:", ownerErr);
        }
      });

      req.io.emit(`user_confirmation_updated_team_member`);

      const filePath = path.join(__dirname, 'confirmation_template.html'); // Match the correct file
      fs.readFile(filePath, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error("Error reading confirmation template:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, "Accepted")
          .replace(/{{message}}/g, "You've been successfully added to the team! 🎉");

        res.send(renderedHtml);
      });
    });
  });
});

// reject invitation
router.get("/rejection/:member_id", (req, res) => {
  const { member_id } = req.params;

  if (!member_id) {
    return res.status(400).json({ error: "Member id not available" });
  }


  // Step 1: Check current member_status
  const checkStatusQuery = "SELECT member_status, owner_email, member_name FROM team_member WHERE member_id = ?";
  db.query(checkStatusQuery, [member_id], (checkErr, results) => {
    if (checkErr) {
      console.error("Error checking member status:", checkErr);
      return res.status(500).send("Database error");
    }

    if (results.length === 0) {
      const file_path = "Member_not_found.html"
      const full_path = path.join(__dirname, file_path);
      fs.readFile(full_path, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error("Error reading confirmation template:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{SERVER_URL}}/g, process.env.SERVER_URL)

        return res.send(renderedHtml);
      });
      return;
    }


    const currentStatus = results[0]?.member_status;
    const ownerEmail = results[0]?.owner_email;
    const memberName = results[0]?.member_name;

    // If already confirmed or rejected, show proper UI
    if (currentStatus === "Accepted") {
      const filePath = path.join(__dirname, "already_confirmed_template.html"); // Make sure filename is correct

      return fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) {
          console.error("Error loading HTML file:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, currentStatus)

        return res.send(renderedHtml);
      });
    }

    // Step 2: Update to Rejected
    const updateQuery = `
      UPDATE team_member 
      SET member_status = 'Rejected', invitation_token = NULL 
      WHERE member_id = ?
    `;

    db.query(updateQuery, [member_id], async (updateErr, result) => {
      if (updateErr) {
        console.error("Error updating to Rejected:", updateErr);
        return res.status(500).send("Failed to reject invitation");
      }

      // Get owner name for email notification
      const ownerQuery = "SELECT user_name FROM owner WHERE user_email = ?";
      db.query(ownerQuery, [ownerEmail], async (ownerErr, ownerResults) => {
        if (!ownerErr && ownerResults.length > 0) {
          const ownerName = ownerResults[0].user_name;

          // Send email notification to owner
          await send_owner_notification_email(ownerEmail, ownerName, memberName, "Rejected");
        } else {
          console.error("Error fetching owner details for email:", ownerErr);
        }
      });

      req.io.emit(`user_confirmation_updated_team_member`);

      // Step 3: Load HTML template and respond
      const filePath = path.join(__dirname, "confirmation_template.html"); // Same template file
      fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) {
          console.error("Error loading HTML file:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, "Rejected")
          .replace(/{{message}}/g, "You've successfully rejected the invitation.");

        res.send(renderedHtml);
      });
    });
  });
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
  const { user_email, team_members, event_id } = req.body;
  
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
    for (const member of team_members) {
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

      if(event.event_request_type === 'package'){
        event_title = event.package_name;
      }else if (event.event_request_type === 'service'){
        event_title = event.service_name;
      }else if (event.event_request_type === 'equipment'){
        event_title = event.event_name;
      }

      
      if (memberData.length > 0 && memberData[0].team_member_email) {
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
    
    // Emit socket event for real-time updates
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
        templateFile = 'already_accepted_event.html';
      } else if (currentStatus === 'Rejected') {
        templateFile = 'already_rejected_event.html';
      }
      
      try {
        // Read the template file
        const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');

        let event_title;

        if(event.event_request_type === 'package'){
          event_title = event.package_name;
        }else if (event.event_request_type === 'service'){
          event_title = event.service_name;
        }else if (event.event_request_type === 'equipment'){
          event_title = event.event_name;
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
      }
      
      // Emit socket event for real-time updates
      req.io.emit(`event_member_response_${event_id}`, {
        event_id,
        member_id,
        member_name,
        status,
        event_status: newEventStatus
      });
      
      // Also emit a general event update
      req.io.emit(`event_status_changed_${event_id}`, {
        event_id,
        status: newEventStatus
      });
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

module.exports = router;
