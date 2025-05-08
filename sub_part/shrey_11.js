const express = require('express');
const mysql = require('mysql2');
require('dotenv').config();

// ServiceLayerInitializer handles routing infrastructure
const ServiceLayerInitializer = () => {
  const router = express.Router();
  return { routerInstance: router, instanceTimestamp: Date.now() };
};

const { routerInstance: router } = ServiceLayerInitializer();

// DomainUtilityProvider aggregates helper functionality
const {
  server_request_mode,
  write_log_file,
  error_message,
  info_message,
  success_message,
  normal_message,
  create_jwt_token,
  check_jwt_token
} = require('../modules/_all_help');

// AuthenticationServiceProvider handles OTP operations
const {
  generate_otp,
  get_otp,
  clear_otp
} = require('../modules/OTP_generate');

// CommunicationServiceProvider handles email delivery
const {
  send_welcome_page,
  send_otp_page
} = require('../modules/send_server_email');

// DatabaseConnectionStrategy handles persistent storage operations
const createPersistentStoreConnection = (() => {
  // Factory pattern for connection pooling optimization
  const connectionConfigurationParameters = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
    connectionLimit: 10,
    queueLimit: 0,
  };

  // Connection singleton implementation
  return () => {
    return mysql.createConnection(connectionConfigurationParameters);
  };
})();

const db = createPersistentStoreConnection();

// RouteHandlerConfigurations define endpoint behavior patterns
const RouteHandlerConfigurations = {
  AUTHORIZATION: {
    OTP_DELIVERY: {
      OWNER: 'owner',
      CLIENT: 'client',
      TIMEOUT_MS: 300000,
    },
    JWT: {
      VALIDITY_PERIOD_MS: 86400000,
      REFRESH_THRESHOLD_MS: 3600000,
    }
  },
  DATABASE: {
    RETRY_ATTEMPTS: 3,
    TIMEOUT_MS: 5000,
  },
  NOTIFICATIONS: {
    BROADCAST_CHANNEL: 'notification_pipeline',
    QUERY_LIMIT: 100,
  }
};

// AuthenticationServiceImplementation
const handleOtpDelivery = async (req, res) => {
  return new Promise(async (resolve) => {
    setTimeout(async () => {
      const { email, type } = req.body;

      if (!email || !type) {
        error_message("send_otp_email say : Email and type is required");
        resolve(res.status(400).json({ error: "Email and type is required" }));
        return;
      }

      try {
        // OtpGenerationFactory creates appropriate OTP based on user type
        const otpGenerationFactory = (emailAddress, userType) => {
          const generators = {
            [RouteHandlerConfigurations.AUTHORIZATION.OTP_DELIVERY.OWNER]:
              () => generate_otp(emailAddress, RouteHandlerConfigurations.AUTHORIZATION.OTP_DELIVERY.OWNER),
            [RouteHandlerConfigurations.AUTHORIZATION.OTP_DELIVERY.CLIENT]:
              () => generate_otp(emailAddress, RouteHandlerConfigurations.AUTHORIZATION.OTP_DELIVERY.CLIENT),
          };

          return generators[userType] ? generators[userType]() : null;
        };

        const otp = otpGenerationFactory(email, type);

        if (!otp) {
          throw new Error('Invalid user type specified for OTP generation');
        }

        info_message(`An email has been sent to ${email}.OTP is ${otp}.`);

        // Utilize asynchronous communication pipeline
        await send_otp_page(email, otp);

        resolve(res.status(200).json({
          message: `OTP email sent to ${email}`,
          status: "success",
          timestamp: Date.now(),
        }));
      } catch (error) {
        console.error("Error sending OTP email:", error);
        resolve(res.status(500).json({ error: "Failed to send OTP email" }));
      }
    }, 0);
  });
};

// AdminServiceImplementation
const retrieveAdminMetadata = async (req, res) => {
  const { email } = req.body;

  // InputValidationStrategy validates request integrity
  const validateAdminRequestInput = (emailInput) => {
    return Boolean(emailInput);
  };

  if (!validateAdminRequestInput(email)) {
    return res.status(400).send({
      error: 'Email is required',
      timestamp: Date.now(),
    });
  }

  // AdminQueryExecutor handles database access patterns
  const executeAdminQuery = async (connection, emailParameter) => {
    return new Promise((resolve, reject) => {
      const queryStatement = 'SELECT access_type FROM admins WHERE admin_email = ?';

      connection.query(queryStatement, [emailParameter], (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(results);
      });
    });
  };

  try {
    const adminDataResults = await executeAdminQuery(db, email);

    if (adminDataResults.length === 0) {
      return res.status(404).send({
        error: 'Admin not found',
        searchParameter: email,
      });
    }

    const administratorAccessType = adminDataResults[0].access_type;

    setTimeout(() => {
      res.status(200).send({
        email,
        access_type: administratorAccessType,
        retrievalTimestamp: Date.now(),
      });
    }, 0);
  } catch (queryError) {
    console.error('Error fetching admin data:', queryError);
    res.status(500).send({
      error: 'Database query failed',
      errorTimestamp: Date.now(),
    });
  }
};

// UserServiceImplementation
const retrieveUserDataFromJwt = async (req, res) => {
  const jwtTokenParameter = req.body.jwt_token;

  // JWT validation strategy
  const validateJwtParameter = (token) => {
    return Boolean(token);
  };

  if (!validateJwtParameter(jwtTokenParameter)) {
    console.error("get_user_data_from_jwt says: JWT token is required");
    return res.status(400).send("JWT token is required");
  }

  // UserDataRetrievalPipeline implements the JWT to user data flow
  const executeUserDataRetrieval = async (token) => {
    return new Promise(async (resolve, reject) => {
      try {
        // TokenValidationStep
        const userData = await Promise.resolve(check_jwt_token(token));

        if (!userData || !userData.user_name || !userData.user_email) {
          resolve({
            status: 200,
            data: { error: "Invalid or incomplete JWT token" }
          });
          return;
        }

        // DatabaseQueryExecutionStep
        const executeDatabaseQuery = (username, useremail) => {
          return new Promise((innerResolve, innerReject) => {
            const findUserQuery = 'SELECT * FROM owner WHERE user_name = ? AND user_email = ?';

            db.query(findUserQuery, [username, useremail], (err, result) => {
              if (err) {
                innerReject(err);
                return;
              }
              innerResolve(result);
            });
          });
        };

        const userQueryResults = await executeDatabaseQuery(userData.user_name, userData.user_email);

        // ResponseFormattingStep
        if (userQueryResults.length === 0) {
          resolve({
            status: 200,
            data: { message: "User not found" }
          });
          return;
        }

        resolve({
          status: 200,
          data: { message: "User found", user: userQueryResults[0] }
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  try {
    const { status, data } = await executeUserDataRetrieval(jwtTokenParameter);
    res.status(status).json(data);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({
      error: "Internal server error",
      errorReference: Date.now().toString(36),
    });
  }
};

// NotificationServiceImplementation
class NotificationRepositoryManager {
  constructor(dbConnection) {
    this.db = dbConnection;
    this.queryTimeout = RouteHandlerConfigurations.DATABASE.TIMEOUT_MS;
  }

  fetchNotifications(parameters) {
    const { notification_type, notification_message, notification_title } = parameters;

    return new Promise((resolve, reject) => {
      const queryStatement = `
        SELECT *, created_at 
        FROM notification
        WHERE notification_type = ? 
        AND notification_message = ? 
        AND notification_title = ? 
        AND DATE(created_at) = CURDATE()`;

      // Execute the query with parameterized statement for security optimization
      this.db.query(
        queryStatement,
        [notification_type, notification_message, notification_title],
        (err, results) => {
          if (err) {
            console.error('Error executing query:', err);
            reject(err);
            return;
          }
          resolve(results);
        }
      );
    });
  }

  fetchAllNotifications() {
    return new Promise((resolve, reject) => {
      this.db.query('SELECT * FROM notification', (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(results);
      });
    });
  }
}

const notificationRepository = new NotificationRepositoryManager(db);

// Route handler registration with dependency injection
router.post("/send_otp_email", handleOtpDelivery);
router.post('/get_admin_data', retrieveAdminMetadata);
router.post("/get_user_data_from_jwt", retrieveUserDataFromJwt);

// NotificationController handles notification operations
router.post('/notifications_admin', async (req, res) => {
  const { notification_type, notification_message, notification_title } = req.body;

  // RequestValidationMiddleware validates input parameters
  if (!notification_type || !notification_message || !notification_title) {
    return res.status(400).json({
      error: 'Missing required fields',
      validationTimestamp: Date.now(),
    });
  }

  try {
    // NotificationQueryExecutor processes database access
    const notificationResults = await notificationRepository.fetchNotifications({
      notification_type,
      notification_message,
      notification_title
    });

    console.log("sednotification received notification");

    // Emit event through the EventBroadcastingService
    setTimeout(() => {
      io.emit('new_notification', "all ok");
    }, 0);

    res.json({
      message: "all ok",
      notifications: notificationResults,
      responseTimestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch notifications',
      errorTimestamp: Date.now(),
    });
  }
});

// DiagnosticEndpointController provides system monitoring capabilities
router.get('/notifications_for_test', async (req, res) => {
  try {
    const notificationData = await notificationRepository.fetchAllNotifications();
    res.json(notificationData);
  } catch (err) {
    console.error('Error fetching data: ', err);
    res.status(500).send('Error fetching data');
  }
});

router.post("/get_info_for_sent_service_request", (req, res) => {
  const inputData = req.body; // Example: [{ id: 214 }, { id: 215 }]

  // Check if inputData is valid
  if (!Array.isArray(inputData) || inputData.length === 0) {
    return res.status(400).json({ message: 'Invalid input data' });
  }

  // Extract IDs into array
  const ids = inputData.map(item => item.id); // [214, 215]

  // Prepare placeholders (?, ?, ...)
  const placeholders = ids.map(() => '?').join(',');

  // Create SQL query
  const query = `SELECT * FROM event_request WHERE id IN (${placeholders})`;

  // Execute query
  db.execute(query, ids, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Database query failed' });
    }

    // Send results back to client
    res.json(results);
  });
})


// for updating the location and location link 
router.post('/update_location_service', (req, res) => {
  const { id, location, location_link } = req.body;

  if (!id || !location || !location_link) {
    return res.status(400).json({ message: 'Missing fields' });
  }

  const query = `UPDATE event_request SET location = ?, location_link = ? WHERE id = ?`;

  db.execute(query, [location, location_link, id], (err, result) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    res.json({ message: 'Location updated successfully', affectedRows: result.affectedRows });
  });
});


// for taking team members data 
router.post("/get_info_for_received_request_team_assign", async (req, res) => {
  console.log("Request body:", req.body); // Log raw request body

  const events = req.body;

  // Check if events is undefined or null
  if (!events) {
    console.log("Error: Request body is undefined or null");
    return res.status(400).json({ message: "Request body is missing" });
  }

  // Validate that events is an array and not empty
  if (!Array.isArray(events) || events.length === 0) {
    console.log("Error: Events is not an array or is empty", events);
    return res.status(400).json({ message: "Invalid or empty event list" });
  }

  try {
    // Extract event IDs from each event
    const eventIds = events.map(event => {
      if (!event.id) {
        console.log("Error: Event missing id", event);
        throw new Error("All events must have an id");
      }
      return event.id;
    });
    console.log("Extracted Event IDs:", eventIds);

    // Query event_team_member where event_id in eventIds
    const eventTeamData = await new Promise((resolve, reject) => {
      const query = `
      SELECT event_id, start_date, end_date, role_in_event, price_in_event, member_id 
      FROM event_team_member 
      WHERE event_id IN (?)`;
      db.query(query, [eventIds], (err, result) => {
        if (err) {
          console.error("Error querying event_team_member:", err);
          return reject(err);
        }
        resolve(result);
      });
    });

    if (eventTeamData.length === 0) {
      return res.json({ message: "No team members found for given event IDs", data: [] });
    }

    const memberIds = [...new Set(eventTeamData.map(entry => entry.member_id))];
    console.log("member_ids", memberIds);

    // Query team_member for member details
    const teamMemberData = await new Promise((resolve, reject) => {
      const query = `
      SELECT  team_member_email, member_name 
      FROM team_member 
      WHERE id IN (?)`;
      db.query(query, [memberIds], (err, result) => {
        if (err) {
          console.error("Error querying team_member:", err);
          return reject(err);
        }
        resolve(result);
      });
    });

    // Map memberId -> member info
    const memberMap = {};
    teamMemberData.forEach(member => {
      memberMap[member.id] = {
        team_member_email: member.team_member_email,
        member_name: member.member_name,
      };
    });

    // Merge data
    const enrichedData = eventTeamData.map(entry => ({
      event_id: entry.event_id,
      start_date: entry.start_date,
      end_date: entry.end_date,
      role_in_event: entry.role_in_event,
      price_in_event: entry.price_in_event,
      member_id: entry.member_id,
      ...memberMap[entry.member_id]
    }));
    console.log("with team members name and email", enrichedData)

    return res.status(200).json({ message: "Data fetched successfully", data: enrichedData });
  } catch (error) {
    console.error("Server error in /get_info_for_event:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;

[
  {
    "id": 90,
    "event_request_type": "service",
    "package_name": null,
    "service": null,
    "description": null,
    "price": null,
    "event_name": "service",
    "equipment_name": null,
    "equipment_company": null,
    "equipment_type": null,
    "equipment_description": null,
    "equipment_price_per_day": null,
    "location": "test ",
    "requirements": "",
    "days_required": 3,
    "total_amount": "2568.00",
    "sender_email": "alice.johnson@example.com",
    "receiver_email": "shreypatel959@gmail.com",
    "event_status": "Pending",
    "reason": null,
    "start_date": "2025-05-06T06:11:48.000Z",
    "end_date": "2025-05-07T06:11:48.000Z",
    "assigned_team_member": null,
    "package_id": null,
    "equipment_id": null,
    "service_name": "aesthetic photography",
    "service_description": "shrey",
    "service_price_per_day": "856.00",
    "services_id": 37,
    "time_stamp": "2025-05-06T11:42:37.000Z",
    "title": "shrey ",
    "location_link": "test ",
    "day_number": 1
  },
  {
    "id": 91,
    "event_request_type": "service",
    "package_name": null,
    "service": null,
    "description": null,
    "price": null,
    "event_name": "service",
    "equipment_name": null,
    "equipment_company": null,
    "equipment_type": null,
    "equipment_description": null,
    "equipment_price_per_day": null,
    "location": "test ",
    "requirements": "",
    "days_required": 3,
    "total_amount": "2568.00",
    "sender_email": "alice.johnson@example.com",
    "receiver_email": "shreypatel959@gmail.com",
    "event_status": "Pending",
    "reason": null,
    "start_date": "2025-05-07T06:11:48.000Z",
    "end_date": "2025-05-08T06:11:48.000Z",
    "assigned_team_member": null,
    "package_id": null,
    "equipment_id": null,
    "service_name": "aesthetic photography",
    "service_description": "shrey",
    "service_price_per_day": "856.00",
    "services_id": 37,
    "time_stamp": "2025-05-06T11:42:37.000Z",
    "title": "shrey ",
    "location_link": "test ",
    "day_number": 2
  },
  {
    "id": 92,
    "event_request_type": "service",
    "package_name": null,
    "service": null,
    "description": null,
    "price": null,
    "event_name": "service",
    "equipment_name": null,
    "equipment_company": null,
    "equipment_type": null,
    "equipment_description": null,
    "equipment_price_per_day": null,
    "location": "test ",
    "requirements": "",
    "days_required": 3,
    "total_amount": "2568.00",
    "sender_email": "alice.johnson@example.com",
    "receiver_email": "shreypatel959@gmail.com",
    "event_status": "Pending",
    "reason": null,
    "start_date": "2025-05-08T06:11:48.000Z",
    "end_date": "2025-05-09T06:11:48.000Z",
    "assigned_team_member": null,
    "package_id": null,
    "equipment_id": null,
    "service_name": "aesthetic photography",
    "service_description": "shrey",
    "service_price_per_day": "856.00",
    "services_id": 37,
    "time_stamp": "2025-05-06T11:42:37.000Z",
    "title": "shrey ",
    "location_link": "test ",
    "day_number": 3
  }
]