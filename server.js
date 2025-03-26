const express = require('express');
const mysql = require('mysql2');
const cors = require("cors");
const app = express();
require('dotenv').config();
const fs = require('fs');

const shrey11_ = require('./sub_part/other_rout_shrey_11');
const praharsh_routes = require("./sub_part/praharsh_routes");
const adminRoutes = require('./sub_part/Admin_rout');
const team_members = require('./sub_part/team_members');
const ownerRoutes = require('./sub_part/owner_rout');
const ownerRoutes_v2 = require('./sub_part/owner_rout_v2');
const chartRoutes = require('./sub_part/chart_rout');
const reviews_rout = require('./sub_part/reviews_rout');

const calendarRoutes = require('./sub_part/calendar_rout');

// @shrey11_  start ---- 
// @shrey11_  start ---- 
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: false, limit: '200mb' }))

app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
  req.io = io;
  next();
});



const { send_welcome_page, send_otp_page } = require('./modules/send_server_email');
const { server_request_mode, write_log_file, error_message, info_message, success_message,
  normal_message, create_jwt_token, check_jwt_token } = require('./modules/_all_help');

const { generate_otp, get_otp, clear_otp } = require('./modules/OTP_generate');



const https = require('https');
const { Server } = require('socket.io');
const options = {
  key: fs.readFileSync('/etc/letsencrypt/live/srv749838.hstgr.cloud/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/srv749838.hstgr.cloud/fullchain.pem')
};
const server = https.createServer(options, app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});
app.use((req, res, next) => {
  req.io = io; // Attach io to request object
  next();
});
io.on("connection", (socket) => {
  console.log("✅ A user connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("❌ A user disconnected:", socket.id);
  });
});
// Move this to the top level, outside of connection handler
const emitEventRequestNotification = (userEmail, data) => {
  io.emit(`new_event_request_notification_${userEmail}`, data);
};



const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 10000, // 10 seconds
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  authPlugins: {},
};

let db;

function handleDisconnect() {
  db = mysql.createConnection(dbConfig);

  db.connect((err) => {
    if (err) {
      console.error("Database connection failed:", err);
      setTimeout(handleDisconnect, 5000);
    } else {
      console.log("Connected to MySQL database");
    }
  });

  db.on("error", (err) => {
    console.error("Database error:", err);
    if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET") {
      console.log("Reconnecting to database...");
      handleDisconnect(); // Reconnect on error
    } else {
      throw err;
    }
  });
}

handleDisconnect();

// print data in log
app.use((req, res, next) => {
  server_request_mode(req.method, req.url, req.body);
  next();
});

app.get("/", (req, res) => {
  res.send("hi server user running page will be here '/' ")
});

app.delete("/owner-folders/:folder_id", (req, res) => {
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

app.delete("/owner/owner-folders/:folder_id", (req, res) => {
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


      io.emit(`folderDeleted_${user_email}`, folder_id);
      res
        .status(200)
        .json({ message: "Folder and files deleted successfully" });
    });
  });
});

// for notifications 

// @shrey11_ other routes
app.use('/', shrey11_);

// admin routes
app.use('/Admin', adminRoutes);

// owner routes
app.use('/owner', ownerRoutes);
app.use('/owner_v2', ownerRoutes_v2);

// owner routes
app.use('/chart', chartRoutes);

// team members routes
app.use('/team_members', team_members);

// reviews routes
app.use('/reviews', reviews_rout);

// calendar routes
app.use('/calendar', calendarRoutes);





app.post('/add_profile_by_email', (req, res) => {
  const { email, business_profile_base64, user_profile_image_base64 } = req.body;

  // Validate inputs
  if (!email || !business_profile_base64 || !user_profile_image_base64) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Check file sizes (assuming base64 strings)
  const maxSize = 5 * 1024 * 1024; // 5MB limit
  if (business_profile_base64.length > maxSize || user_profile_image_base64.length > maxSize) {
    return res.status(400).json({ error: 'Image file size too large. Maximum size is 5MB' });
  }

  db.query(`SELECT * FROM owner WHERE user_email = ?`, [email], (err, result) => {
    if (err) {
      console.error('Error fetching photographer data:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (result.length === 0) {
      return res.status(404).json({ error: 'Photographer not found' });
    }

    db.query(
      `Update owner set business_profile_base64 = ?, user_profile_image_base64 = ? where user_email = ?`,
      [business_profile_base64, user_profile_image_base64, email],
      (err, result) => {
        if (err) {
          console.error('Error adding photographer profile:', err.message);
          return res.status(500).json({ error: 'Internal server error' });
        }

        db.query(`SELECT * FROM owner WHERE user_email = ?`, [email], (err, result) => {
          if (err) {
            console.error('Error fetching photographer data:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
          }
          res.json(result);
        });
      }
    );
  });
});



app.post('/confirm-equipment-event', (req, res) => {
  const { event_id, user_email, sender_email } = req.body;

  db.query(
    'UPDATE event_request SET event_status = "Accepted" WHERE id = ? AND receiver_email = ?',
    [event_id, user_email],
    (err, result) => {
      if (err) {
        console.error('Error confirming equipment event:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Emit socket event with relevant data
      emitEventRequestNotification(sender_email, {
        type: 'equipment_confirmation',
        event_id,
        status: 'Accepted'
      });

      res.json({ message: 'Equipment event confirmed successfully' });
    }
  );
});



// @shrey11_  End ---- 
// @shrey11_  End ---- 

// @praharsh  start ----
// @praharsh  start ----
app.use("/", praharsh_routes);
// praharsh  End ----
// praharsh  End ----


const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Server is running. .. . . . .`);
});

module.exports = { io, server, app };
require('./sub_part/_io_file');