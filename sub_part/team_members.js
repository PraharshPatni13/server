const express = require("express");
const router = express.Router();
const mysql = require("mysql2");
const moment = require("moment");
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {},
});


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
    console.log("response from the server side ", responseData);

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
router.post("/add_pending_member", (req, res) => {
  const {
    owner_email,
    member_name,
    member_profile_img,
    member_role,
    member_email,
    member_phone
  } = req.body;

  // Check if member with this email already exists for this owner
  const checkQuery = `
    SELECT * FROM team_member
    WHERE owner_email = ? AND team_member_email = ?
  `;

  db.query(checkQuery, [owner_email, member_email], (checkErr, checkResults) => {
    if (checkErr) {
      console.error("Error checking for existing team member:", checkErr);
      return res.status(500).json({ error: "Database error", details: checkErr });
    }

    // If member already exists, return error
    if (checkResults.length > 0) {
      return res.status(400).json({
        error: "Team member with this email already exists",
        member: checkResults[0]
      });
    }

    // Insert the new team member into the database with Pending status
    const insertQuery = `
      INSERT INTO team_member (
        owner_email, 
        member_name, 
        member_profile_img, 
        member_role, 
        team_member_email, 
        team_member_phone, 
        member_status,
        invitation_date
      ) 
      VALUES (?, ?, ?, ?, ?, ?, 'Pending', NOW())
    `;

    db.query(
      insertQuery,
      [
        owner_email,
        member_name,
        member_profile_img,
        member_role,
        member_email,
        member_phone
      ],
      (insertErr, result) => {
        if (insertErr) {
          console.error("Error adding pending team member:", insertErr);
          return res.status(500).json({ error: "Database error", details: insertErr });
        }

        // Return the newly created pending member with its ID
        res.status(201).json({
          message: "Pending team member added successfully",
          member_id: result.insertId
        });
      }
    );
  });
});

// 3. Send invitation to a team member
router.post("/send_invitation", async (req, res) => {
  const {
    owner_email,
    member_email,
    member_role,
    member_name
  } = req.body;

  try {
    // Get owner information for the invitation email
    const ownerQuery = `
      SELECT user_name, business_name 
      FROM owner 
      WHERE user_email = ?
    `;

    db.query(ownerQuery, [owner_email], async (err, results) => {
      if (err || results.length === 0) {
        console.error("Error fetching owner information:", err);
        return res.status(500).json({ error: "Could not fetch owner information" });
      }

      const owner = results[0];
      const businessName = owner.business_name || "Photography Business";

      // Generate a unique invitation token
      const invitationToken = require('crypto').randomBytes(32).toString('hex');

      // Store the invitation token in the database
      const tokenQuery = `
        UPDATE team_member 
        SET invitation_token = ? 
        WHERE owner_email = ? AND team_member_email = ?
      `;

      db.query(tokenQuery, [invitationToken, owner_email, member_email], async (tokenErr) => {
        if (tokenErr) {
          console.error("Error storing invitation token:", tokenErr);
          return res.status(500).json({ error: "Failed to generate invitation" });
        }

        // Construct the invitation link
        const invitationLink = `${process.env.FRONTEND_URL}/accept-invitation/${invitationToken}`;

        // Send email using your preferred email service
        // This is a placeholder - you'll need to implement actual email sending
        try {
          // Example using nodemailer (you would need to install it)
          // const nodemailer = require('nodemailer');
          // const transporter = nodemailer.createTransport({
          //   service: 'gmail',
          //   auth: {
          //     user: process.env.EMAIL_USER,
          //     pass: process.env.EMAIL_PASSWORD
          //   }
          // });

          // const mailOptions = {
          //   from: process.env.EMAIL_USER,
          //   to: member_email,
          //   subject: `Invitation to join ${businessName} as a team member`,
          //   html: `
          //     <h2>You've been invited to join ${businessName}</h2>
          //     <p>Hi ${member_name},</p>
          //     <p>${owner.user_name} has invited you to join their team as a "${member_role}".</p>
          //     <p>Click the button below to accept this invitation:</p>
          //     <p>
          //       <a href="${invitationLink}" style="display:inline-block;padding:10px 20px;background-color:#4f46e5;color:white;text-decoration:none;border-radius:4px;">
          //         Accept Invitation
          //       </a>
          //     </p>
          //     <p>If you did not expect this invitation, you can safely ignore this email.</p>
          //   `
          // };

          // await transporter.sendMail(mailOptions);

          console.log(`Invitation email would be sent to ${member_email} with link ${invitationLink}`);

          // For now, just log the invitation details and return success
          res.status(200).json({
            message: "Invitation sent successfully",
            invitationLink: invitationLink
          });
        } catch (emailErr) {
          console.error("Error sending invitation email:", emailErr);
          return res.status(500).json({ error: "Failed to send invitation email" });
        }
      });
    });
  } catch (error) {
    console.error("Error in send_invitation:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// 5. Accept team member invitation
router.get("/accept-invitation/:token", (req, res) => {
  const { token } = req.params;

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
      SET member_status = 'Active', invitation_token = NULL
      WHERE member_id = ?
    `;

    db.query(updateQuery, [member.member_id], (updateErr) => {
      if (updateErr) {
        console.error("Error accepting invitation:", updateErr);
        return res.status(500).json({ error: "Failed to accept invitation" });
      }

      res.json({ message: "Invitation accepted successfully" });
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

      const sanitizedResults = results.map(user => ({
        user_id: user.user_id,
        user_name: user.user_name,
        user_email: user.user_email,
        business_name: user.business_name,
        business_address: user.business_address,
        phone_number: user.phone_number,
        user_profile_image_base64: user.user_profile_image_base64
      }));

      res.json(sanitizedResults);
    }
  );
});





module.exports = router;
