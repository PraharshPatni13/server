const express = require("express");
const CryptoJS = require('crypto-js');
const router = express.Router();
const mysql = require("mysql2");
const moment = require("moment");
const fs = require('fs');
const path = require('path');


require('dotenv').config();
const { send_team_invitation_email } = require('../modules/send_server_email');

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
  const today = moment().format("YYYY-MM-DD HH:mm:ss"); // Current timestamp
  const { user_email } = req.body; // Extract user email

  if (!user_email) {
    return res.status(400).json({ error: "user_email is required" });
  }

  console.log("before query Request received for get_all_members_status");
  const query = `
      SELECT assigned_team_member, event_request_type, package_name, equipment_name
      FROM event_request 
      WHERE ? BETWEEN start_date AND end_date
  `;

  db.query(query, [today], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Database error", details: err });
    }

    if (results.length === 0) {
      console.log("No data found for the user.");
      return res.json({ assigned_team_member: [], event_details: [] }); // No data found
    }
    console.log("this is for team member assignment ", results);

    const responseData = results.map(row => ({
      assigned_team_member: row.assigned_team_member
        ? String(row.assigned_team_member).split(",").map(item => item.trim())
        : [],
      event_request_type: row.event_request_type,  // Include event_request_type
      event_detail: row.event_request_type === "package" ? row.package_name : row.equipment_name
    }));
    // console.log("response from the server side ", responseData);

    res.json(responseData);
  });
});


router.post("/get_members", (req, res) => {
  const { user_email } = req.body;
  const query = `
        SELECT owner_email,member_id, member_name, member_profile_img, member_role, member_event_assignment, member_status
        FROM team_member where owner_email = ?
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

  const query = `
    SELECT assigned_team_member 
    FROM event_request 
    WHERE receiver_email = ? 
    AND (
      (? BETWEEN start_date AND end_date) OR
      (? BETWEEN start_date AND end_date) OR
      (start_date BETWEEN ? AND ?) OR
      (end_date BETWEEN ? AND ?)
    );
  `;

  // Execute the query
  db.query(
    query,
    [user_email, start_date, end_date, start_date, end_date, start_date, end_date],
    (err, results) => {
      if (err) {
        console.error("Error fetching team members:", err);
        return res.status(500).json({ message: "Database error", error: err });
      }

      console.log("Query Params:", user_email, start_date, end_date);

      const assignedTeamMembers = new Set();

      results.forEach((result) => {
        let assignedTeamMember = result.assigned_team_member;

        // Handle possible JSON string stored in DB
        if (typeof assignedTeamMember === "string") {
          try {
            assignedTeamMember = JSON.parse(assignedTeamMember);
          } catch (error) {
            console.error("Error parsing assigned team members:", error);
            assignedTeamMember = [];
          }
        }

        if (Array.isArray(assignedTeamMember)) {
          assignedTeamMember.forEach((member) => assignedTeamMembers.add(member));
        }
      });

      const busyTeamMembers = [...assignedTeamMembers];

      // Fetch all team members from another table (assuming you have a `team_members` table)
      const allTeamQuery = `SELECT * FROM team_member`;

      db.query(allTeamQuery, [], (err, teamResults) => {
        if (err) {
          console.error("Error fetching all team members:", err);
          return res.status(500).json({ message: "Database error", error: err });
        }

        const allTeamMembers = teamResults.map((row) => row.team_member);

        // Find free team members
        const freeTeamMembers = allTeamMembers.filter(
          (member) => !busyTeamMembers.includes(member)
        );

        return res.status(200).json({
          assignedTeamMembers: busyTeamMembers,
          freeTeamMembers: freeTeamMembers,
        });
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
    // console.log(status);
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

// 2. Add a pending team member
// router.post("/add_pending_member", async (req, res) => {
//   const {
//     owner_email,
//     member_name,
//     member_profile_img,
//     member_role,
//     member_email,
//     member_phone,
//     invitation_link
//   } = req.body;

//   // Check if member with this email already exists for this owner
//   const checkQuery = `
//     SELECT * FROM team_member
//     WHERE owner_email = ? AND team_member_email = ?
//   `;

//   db.query(checkQuery, [owner_email, member_email], (checkErr, checkResults) => {
//     if (checkErr) {
//       console.error("Error checking for existing team member:", checkErr);
//       return res.status(500).json({ error: "Database error", details: checkErr });
//     }

//     // If member already exists, return error
//     if (checkResults.length > 0) {
//       return res.status(400).json({
//         error: "Team member with this email already exists",
//         member: checkResults[0]
//       });
//     }

//     // Insert the new team member into the database with Pending status
//     const insertQuery = `
//       INSERT INTO team_member (
//         owner_email, 
//         member_name, 
//         member_profile_img, 
//         member_role, 
//         team_member_email, 
//         team_member_phone, 
//         member_status,
//         invitation_token,
//         invitation_date
//       ) 
//       VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, NOW())
//     `;

//     db.query(
//       insertQuery,
//       [
//         owner_email,
//         member_name,
//         member_profile_img,
//         member_role,
//         member_email,
//         member_phone,
//         invitation_link
//       ],
//       async (insertErr, result) => {
//         if (insertErr) {
//           console.error("Error adding pending team member:", insertErr);
//           return res.status(500).json({ error: "Database error", details: insertErr });
//         }

//         // Send invitation email
//         // await send_team_member_confirmation_email(member_email, member_name, owner_email, owner_email, member_profile_img, business_name, member_role, invitationLink);

//         // Return the newly created pending member with its ID
//         res.status(201).json({
//           message: "Pending team member added successfully",
//           member_id: result.insertId
//         });
//       }
//     );
//   });
// });

// // 3. Send invitation to a team member
// // 3. Send invitation to a team member
// router.post("/send_invitation", async (req, res) => {
//   const {
//     owner_email,
//     member_email,
//     member_role,
//     member_name
//   } = req.body;

//   try {
//     // Get owner information for the invitation email
//     const ownerQuery = `
//       SELECT user_name, business_name 
//       FROM owner 
//       WHERE user_email = ?
//     `;

//     db.query(ownerQuery, [owner_email], async (err, results) => {
//       if (err || results.length === 0) {
//         console.error("Error fetching owner information:", err);
//         return res.status(500).json({ error: "Could not fetch owner information" });
//       }

//       const owner = results[0];
//       const businessName = owner.business_name || "Photography Business";
//       const ownerName = owner.user_name || "Business Owner";

//       // Generate a unique invitation token
//       const encrypted__From__Email = encryptEmail(owner_email);
//       const encrypted__To__Email = encryptEmail(member_email);
//       const invitationToken = `${require('crypto').randomBytes(32).toString('hex')}__From__${encrypted__From__Email}__To__${encrypted__To__Email}__`;

//       console.log("invitationToken", invitationToken);

//       // Store the invitation token in the database
//       const tokenQuery = `
//         UPDATE team_member 
//         SET invitation_token = ?, invitation_date = NOW() 
//         WHERE owner_email = ? AND team_member_email = ?
//       `;

//       db.query(tokenQuery, [invitationToken, owner_email, member_email], async (tokenErr) => {
//         if (tokenErr) {
//           console.error("Error storing invitation token:", tokenErr);
//           return res.status(500).json({ error: "Failed to generate invitation" });
//         }

//         const getIdQuery = `
//           SELECT member_id FROM team_member 
//           WHERE owner_email = ? AND team_member_email = ?
//         `;

//         db.query(getIdQuery, [owner_email, member_email], async (idErr, idResult) => {
//           if (idErr || idResult.length === 0) {
//             console.error("Error fetching member ID:", idErr);
//             return res.status(500).json({ error: "Failed to fetch member ID" });
//           }

//           const member_id = idResult[0].member_id;
//           console.log("member_id is", member_id);

//           const invitationLink = `${process.env.SERVER_URL}/team_members/accept-invitation/${invitationToken}`;

//           // Send invitation email
//           try {
//             const emailSent = await send_team_invitation_email(
//               member_email,
//               member_name,
//               ownerName,
//               businessName,
//               member_role,
//               invitationLink,
//               member_id
//             );

//             if (emailSent) {
//               return res.status(200).json({
//                 message: "Invitation sent successfully",
//                 invitationLink
//               });
//             } else {
//               return res.status(500).json({ error: "Failed to send invitation email" });
//             }
//           } catch (emailErr) {
//             console.error("Error sending invitation email:", emailErr);
//             return res.status(500).json({ error: "Failed to send invitation email" });
//           }
//         });
//       });
//     });
//   } catch (error) {
//     console.error("Error in send_invitation:", error);
//     res.status(500).json({ error: "Server error", details: error.message });
//   }
// });

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

// 5. Accept team member invitation - GET endpoint for browser redirects
// router.get("/accept-invitation/:member_id", (req, res) => {
//   const { member_id } = req.params;

//   const query = "select * from team_member where member_id = ? "
//   // const rawtoken = decodeURIComponent(token);
//   console.log("member id is ", member_id);

//   // 🧾 Read and render the HTML template
//   const filePath = path.join(__dirname, 'invitation_template.html');
//   fs.readFile(filePath, 'utf8', (err, html) => {
//     if (err) {
//       console.error('Error reading template:', err);
//       return res.status(500).send('Error loading invitation page');
//     }
//     const renderedHtml = html.replace(/{{member_id}}/g, member_id); // example

//     res.send(renderedHtml);

//     // const renderedHtml = html
//     //   .replace(/{{business_name}}/g, invitationData.business_name)
//     //   .replace(/{{member_name}}/g, invitationData.member_name)
//     //   .replace(/{{owner_name}}/g, invitationData.owner_name)
//     //   .replace(/{{member_role}}/g, invitationData.member_role)
//     //   .replace(/{{invitation_link}}/g, invitationData.invitation_link);

//     // res.send(renderedHtml);
//   });
// });

router.get("/accept-invitation/:member_id", (req, res) => {
  const { member_id } = req.params;

  const memberQuery = "SELECT * FROM team_member WHERE member_id = ?";

  db.query(memberQuery, [member_id], (memberErr, memberResults) => {
    if (memberErr || memberResults.length === 0) {
      console.error("Error fetching team member:", memberErr);
      return res.status(500).send("Team member not found");
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

  const checkStatusQuery = "SELECT member_status FROM team_member WHERE member_id = ?";
  db.query(checkStatusQuery, [member_id], (checkErr, results) => {
    if (checkErr) {
      console.error("Error checking member status:", checkErr);
      return res.status(500).send("Database error");
    }

    if (results.length === 0) {
      return res.status(404).send("Member not found");
    }

    const currentStatus = results[0].member_status;

    if (currentStatus === "Confirmed" || currentStatus === "Rejected") {
      // Already confirmed/rejected — return a message
      const filePath = path.join(__dirname, 'confirmation_template.html'); // Make sure this matches your file
      return fs.readFile(filePath, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error('Error reading template:', readErr);
          return res.status(500).send('Error loading invitation page');
        }

        const msg = currentStatus === "Confirmed"
          ? "You’ve already accepted the invitation ✅"
          : "You’ve already rejected the invitation ❌";

        const renderedHtml = html
          .replace(/{{status}}/g, currentStatus)
          .replace(/{{message}}/g, msg);

        return res.send(renderedHtml);
      });
    }

    // Step 2: Update to Confirmed
    const updateQuery = "UPDATE team_member SET member_status = ? WHERE member_id = ?";
    db.query(updateQuery, ["Confirmed", member_id], (updateErr, result) => {
      if (updateErr) {
        console.error("Error updating member status:", updateErr);
        return res.status(500).send("Could not update member to confirmed");
      }

      req.io.emit(`user_confirmation_updated_team_member`);

      const filePath = path.join(__dirname, 'confirmation_template.html'); // Match the correct file
      fs.readFile(filePath, 'utf8', (readErr, html) => {
        if (readErr) {
          console.error("Error reading confirmation template:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, "Confirmed")
          .replace(/{{message}}/g, "You’ve been successfully added to the team! 🎉");

        res.send(renderedHtml);
      });
    });
  });
});


// reject invitation
router.get("/rejection/:member_id", (req, res) => {
  const { member_id } = req.params;
  console.log("member id ", member_id);

  if (!member_id) {
    return res.status(400).json({ error: "Member id not available" });
  }

  // Step 1: Check current member_status
  const checkStatusQuery = "SELECT member_status FROM team_member WHERE member_id = ?";
  db.query(checkStatusQuery, [member_id], (checkErr, results) => {
    if (checkErr) {
      console.error("Error checking member status:", checkErr);
      return res.status(500).send("Database error");
    }

    if (results.length === 0) {
      return res.status(404).send("Member not found");
    }

    const currentStatus = results[0].member_status;

    // If already confirmed or rejected, show proper UI
    if (currentStatus === "Confirmed" || currentStatus === "Rejected") {
      const filePath = path.join(__dirname, "confirmation_template.html"); // Make sure filename is correct

      return fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) {
          console.error("Error loading HTML file:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const msg =
          currentStatus === "Confirmed"
            ? "You’ve already accepted the invitation ✅"
            : "You’ve already rejected the invitation ❌";

        const renderedHtml = html
          .replace(/{{status}}/g, currentStatus)
          .replace(/{{message}}/g, msg);

        return res.send(renderedHtml);
      });
    }

    // Step 2: Update to Rejected
    const updateQuery = `
      UPDATE team_member 
      SET member_status = 'Rejected', invitation_token = NULL 
      WHERE member_id = ?
    `;

    db.query(updateQuery, [member_id], (updateErr, result) => {
      if (updateErr) {
        console.error("Error updating to Rejected:", updateErr);
        return res.status(500).send("Failed to reject invitation");
      }

      req.io.emit(`user_confirmation_updated_team_member`);

      // Step 3: Load HTML template and respond
      const filePath = path.join(__dirname, "confirm.html"); // Same template file
      fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) {
          console.error("Error loading HTML file:", readErr);
          return res.status(500).send("Error loading confirmation page");
        }

        const renderedHtml = html
          .replace(/{{status}}/g, "Rejected")
          .replace(/{{message}}/g, "You’ve successfully rejected the invitation.");

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
router.post("/accept-invitation", (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Invitation token is required" });
  }

  const query = `
    SELECT * FROM team_member
    WHERE invitation_token = ?
  `;

  db.query(query, [token], (err, results) => {
    if (err) {
      console.error("Error checking invitation token:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Invalid or expired invitation token" });
    }

    const member = results[0];

    // Update the member status to Active
    const updateQuery = `
      UPDATE team_member
      SET member_status = 'Active', invitation_token = NULL, confirmation_date = NOW()
      WHERE member_id = ?
    `;

    db.query(updateQuery, [member.member_id], (updateErr) => {
      if (updateErr) {
        console.error("Error accepting invitation:", updateErr);
        return res.status(500).json({ error: "Failed to accept invitation" });
      }

      // Return success with member details
      res.json({
        message: "Invitation accepted successfully",
        member: {
          id: member.member_id,
          name: member.member_name,
          role: member.member_role,
          email: member.team_member_email
        }
      });
    });
  });
});

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
      console.log("results from photographers", results);

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





module.exports = router;
