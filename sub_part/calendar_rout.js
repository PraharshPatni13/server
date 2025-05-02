const express = require("express");
const router = express.Router();
const mysql = require("mysql2");
const { send_event_confirmation_email } = require("../modules/send_server_email");
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  authPlugins: {},
});


function formatDate(isoString) {
  const date = new Date(isoString);
  const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };
  return date.toLocaleString('en-US', options);
}

router.get("/get_all_today_events", (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get yesterday's start
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Get tomorrow's end
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  // Query to get all events between yesterday and tomorrow
  const query = `
    SELECT * FROM events 
    WHERE start >= ? AND start <= ?
    ORDER BY start ASC`;

  db.query(query, [yesterday, tomorrow], (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).json({ error: "Failed to fetch events" });
    }

    // console.log(results);


    res.json({
      total_events: results.length,
      events: results
    });
  });
});

// Create a new event
router.post("/add-event", (req, res) => {
  const { title, start, end, description, backgroundColor, user_email } =
    req.body;

  // Directly insert the event, assuming user_email is valid and exists in the owner table
  const query =
    "INSERT INTO events (title, start, end, description, backgroundColor, user_email) VALUES (?, ?, ?, ?, ?, ?)";

  db.query(
    query,
    [title, start, end, description, backgroundColor, user_email],
    (err, result) => {
      if (err) {
        console.error("Error creating event:", err);
        return res.status(500).json({ error: "Failed to create event" });
      }
      res
        .status(201)
        .json({ id: result.insertId, message: "Event created successfully" });
    }
  );
});
// router.post("/add-event-with-success", (req, res) => {
//   const { title, start, end, description, backgroundColor, user_email } =
//     req.body;

//   console.log(req.body);

//   // Directly insert the event, assuming user_email is valid and exists in the owner table
//   const query =
//     "INSERT INTO events (title, start, end, description, backgroundColor, user_email) VALUES (?, ?, ?, ?, ?, ?)";

//   db.query(
//     query,
//     [title, start, end, description, backgroundColor, user_email],
//     (err, result) => {
//       if (err) {
//         console.error("Error creating event:", err);
//         return res.status(500).json({ error: "Failed to create event" });
//       }
//       console.log(title, formatDate(start), formatDate(end), description, user_email);
//       // send_event_confirmation_email(sender_email, title, formatDate(start), formatDate(end), description,event_location, user_email);

//       res
//         .status(201)
//         .json({ id: result.insertId, message: "Event created successfully" });
//     }
//   );
// });

// Get all events for a specific user
router.post("/add-event-with-success", (req, res) => {
  const { title, start, end, description, backgroundColor, user_email, team_members } =
    req.body;


  const memberIdsOnly = team_members?.map(member => member.member_id);


  // Directly insert the event, assuming user_email is valid and exists in the owner table
  const query =
    "INSERT INTO events (title, start, end, description, backgroundColor, user_email, assigned_members) VALUES (?, ?, ?, ?, ?, ?, ?)";

  db.query(
    query,
    [title, start, end, description, backgroundColor, user_email, JSON.stringify(memberIdsOnly)],
    (err, result) => {
      if (err) {
        console.error("Error creating event:", err);
        return res.status(500).json({ error: "Failed to create event" });
      }
      console.log(title, formatDate(start), formatDate(end), description, user_email);
      // send_event_confirmation_email(sender_email, title, formatDate(start), formatDate(end), description,event_location, user_email);

      res
        .status(201)
        .json({ id: result.insertId, message: "Event created successfully" });
    }
  );
});

router.post("/events_by_user", (req, res) => {
  const { user_email } = req.body;


  // Query to fetch events by user_email
  const query = "SELECT * FROM events WHERE user_email = ?";

  db.query(query, [user_email], (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).json({ error: "Failed to fetch events" });
    }
    if (results.length === 0) {
      return res.status(200).json({ message: "No events found for this user" });
    }
    res.json(results);
  });
});

// Update an event
router.put("/events/:id", (req, res) => {
  const eventId = req.params.id;
  const { title, start, end, description, backgroundColor } = req.body;

  const query =
    "UPDATE events SET title = ?, start = ?, end = ?, description = ?, backgroundColor = ? WHERE id = ?";

  db.query(
    query,
    [title, start, end, description, backgroundColor, eventId],
    (err, result) => {
      if (err) {
        console.error("Error updating event:", err);
        return res.status(500).json({ error: "Failed to update event" });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Event not found" });
      }
      res.json({ message: "Event updated successfully" });
    }
  );
});

// Delete an event
router.delete("/events/:id", (req, res) => {
  const eventId = req.params.id;
  const query = "DELETE FROM events WHERE id = ?";

  db.query(query, [eventId], (err, result) => {
    if (err) {
      console.error("Error deleting event:", err);
      return res.status(500).json({ error: "Failed to delete event" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json({ message: "Event deleted successfully" });
  });
});

module.exports = router;
