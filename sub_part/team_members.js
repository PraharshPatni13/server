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
  console.log("Request received for get_all_members_status");
  const today = moment().format("YYYY-MM-DD HH:mm:ss"); // Current timestamp
  const { user_email } = req.body; // Extract user email

  if (!user_email) {
    return res.status(400).json({ error: "user_email is required" });
  }

  console.log("before query Request received for get_all_members_status");
  const query = `
  SELECT assigned_team_member, event_request_type, package_name, equipment_name
  FROM event_request 
  WHERE ? BETWEEN start_date AND end_date AND receiver_email = ?
`;

  db.query(query, [today, user_email], (err, results) => {
    console.log("running query");
    if (err) {
      return res.status(200).json({ error: "Database error", details: err });
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

module.exports = router;
