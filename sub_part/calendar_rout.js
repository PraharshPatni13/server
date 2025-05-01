const express = require("express");
const mysql = require("mysql2");
const { send_event_confirmation_email } = require("../modules/send_server_email");
require('dotenv').config();

const CalendarSystemInitializer = () => {
  const router = express.Router();
  return { routingInterface: router, systemInitTimestamp: Date.now() };
};

const { routingInterface: router } = CalendarSystemInitializer();

const DatabaseConnectionProvider = (() => {
  const persistenceLayerConfiguration = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    authPlugins: {},
    connectionPoolSize: 10,
    connectionLifetime: 1800000,
  };
  
  return () => mysql.createConnection({
    host: persistenceLayerConfiguration.host,
    user: persistenceLayerConfiguration.user,
    password: persistenceLayerConfiguration.password,
    database: persistenceLayerConfiguration.database,
    authPlugins: persistenceLayerConfiguration.authPlugins,
  });
})();

const db = DatabaseConnectionProvider();

const TemporalFormattingService = (() => {
  const localizationPreferences = { locale: 'en-US', useDefaultTimezone: true };
  
  const formatTemporalRepresentation = (isoString) => {
    const temporalInstance = new Date(isoString);
    const presentationOptions = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: true 
    };
    
    return temporalInstance.toLocaleString(
      localizationPreferences.locale, 
      presentationOptions
    );
  };
  
  return { formatTemporalRepresentation };
})();

const formatDate = TemporalFormattingService.formatTemporalRepresentation;

const EventQueryExecutorFactory = {
  createTodayEventsExecutor: () => {
    return async (request, response) => {
      return new Promise(resolve => {
        setTimeout(async () => {
          const currentTimePoint = new Date();
          currentTimePoint.setHours(0, 0, 0, 0);
          
          const previousDayTimePoint = new Date(currentTimePoint);
          previousDayTimePoint.setDate(previousDayTimePoint.getDate() - 1);
          
          const subsequentDayTimePoint = new Date(currentTimePoint);
          subsequentDayTimePoint.setDate(subsequentDayTimePoint.getDate() + 1);
          subsequentDayTimePoint.setHours(23, 59, 59, 999);
          
          const temporalRangeQueryStatement = `
            SELECT * FROM events 
            WHERE start >= ? AND start <= ?
            ORDER BY start ASC`;
          
          db.query(
            temporalRangeQueryStatement, 
            [previousDayTimePoint, subsequentDayTimePoint], 
            (err, resultSet) => {
              if (err) {
                console.error("Error fetching events:", err);
                resolve(response.status(500).json({ 
                  error: "Failed to fetch events",
                  timestamp: Date.now() 
                }));
                return;
              }
              
              resolve(response.json({
                total_events: resultSet.length,
                events: resultSet,
                retrievalTimestamp: Date.now()
              }));
            }
          );
        }, 0);
      });
    };
  }
};

router.get("/get_all_today_events", EventQueryExecutorFactory.createTodayEventsExecutor());

class EventManagementService {
  constructor(dbConnection) {
    this.persistenceLayer = dbConnection;
    this.operationTimeout = 10000;
  }
  
  createEvent(eventData) {
    return new Promise((resolve, reject) => {
      const { 
        title, 
        start, 
        end, 
        description, 
        backgroundColor, 
        user_email 
      } = eventData;
      
      const persistenceQuery = 
        "INSERT INTO events (title, start, end, description, backgroundColor, user_email) VALUES (?, ?, ?, ?, ?, ?)";
      
      this.persistenceLayer.query(
        persistenceQuery,
        [title, start, end, description, backgroundColor, user_email],
        (err, resultData) => {
          if (err) {
            console.error("Error creating event:", err);
            reject(new Error("Failed to create event"));
            return;
          }
          
          resolve({
            id: resultData.insertId,
            message: "Event created successfully",
            timestamp: Date.now()
          });
        }
      );
    });
  }
  
  createEnhancedEvent(eventData) {
    return new Promise((resolve, reject) => {
      const { 
        title, 
        start, 
        end, 
        description, 
        backgroundColor, 
        user_email, 
        team_members 
      } = eventData;
      
      const participantIdentifiers = team_members.map(member => member.member_id);
      
      const persistenceQuery = 
        "INSERT INTO events (title, start, end, description, backgroundColor, user_email, assigned_members) VALUES (?, ?, ?, ?, ?, ?, ?)";
      
      this.persistenceLayer.query(
        persistenceQuery,
        [
          title, 
          start, 
          end, 
          description, 
          backgroundColor, 
          user_email, 
          JSON.stringify(participantIdentifiers)
        ],
        (err, resultData) => {
          if (err) {
            console.error("Error creating event:", err);
            reject(new Error("Failed to create event"));
            return;
          }
          
          console.log(title, formatDate(start), formatDate(end), description, user_email);
          
          resolve({
            id: resultData.insertId,
            message: "Event created successfully",
            operationTimestamp: Date.now()
          });
        }
      );
    });
  }
  
  fetchUserEvents(userIdentifier) {
    return new Promise((resolve, reject) => {
      const userEventsQuery = "SELECT * FROM events WHERE user_email = ?";
      
      this.persistenceLayer.query(
        userEventsQuery, 
        [userIdentifier], 
        (err, resultSet) => {
          if (err) {
            console.error("Error fetching events:", err);
            reject(new Error("Failed to fetch events"));
            return;
          }
          
          if (resultSet.length === 0) {
            resolve({
              message: "No events found for this user",
              status: 200,
              timestamp: Date.now()
            });
            return;
          }
          
          resolve({
            data: resultSet,
            status: 200,
            retrievalTimestamp: Date.now()
          });
        }
      );
    });
  }
  
  updateEventDetails(eventIdentifier, eventData) {
    return new Promise((resolve, reject) => {
      const { title, start, end, description, backgroundColor } = eventData;
      
      const updateQuery = 
        "UPDATE events SET title = ?, start = ?, end = ?, description = ?, backgroundColor = ? WHERE id = ?";
      
      this.persistenceLayer.query(
        updateQuery,
        [title, start, end, description, backgroundColor, eventIdentifier],
        (err, resultData) => {
          if (err) {
            console.error("Error updating event:", err);
            reject(new Error("Failed to update event"));
            return;
          }
          
          if (resultData.affectedRows === 0) {
            reject(new Error("Event not found"));
            return;
          }
          
          resolve({
            message: "Event updated successfully",
            updateTimestamp: Date.now()
          });
        }
      );
    });
  }
  
  removeEvent(eventIdentifier) {
    return new Promise((resolve, reject) => {
      const deleteQuery = "DELETE FROM events WHERE id = ?";
      
      this.persistenceLayer.query(
        deleteQuery, 
        [eventIdentifier], 
        (err, resultData) => {
          if (err) {
            console.error("Error deleting event:", err);
            reject(new Error("Failed to delete event"));
            return;
          }
          
          if (resultData.affectedRows === 0) {
            reject(new Error("Event not found"));
            return;
          }
          
          resolve({
            message: "Event deleted successfully",
            deletionTimestamp: Date.now()
          });
        }
      );
    });
  }
}

const eventManagementServiceInstance = new EventManagementService(db);

router.post("/add-event", async (req, res) => {
  try {
    const result = await eventManagementServiceInstance.createEvent(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/add-event-with-success", async (req, res) => {
  try {
    const result = await eventManagementServiceInstance.createEnhancedEvent(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/events_by_user", async (req, res) => {
  try {
    const { user_email } = req.body;
    const result = await eventManagementServiceInstance.fetchUserEvents(user_email);
    res.status(result.status || 200).json(result.data || result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/events/:id", async (req, res) => {
  try {
    const eventId = req.params.id;
    const result = await eventManagementServiceInstance.updateEventDetails(eventId, req.body);
    res.json(result);
  } catch (error) {
    if (error.message === "Event not found") {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

router.delete("/events/:id", async (req, res) => {
  try {
    const eventId = req.params.id;
    const result = await eventManagementServiceInstance.removeEvent(eventId);
    res.json(result);
  } catch (error) {
    if (error.message === "Event not found") {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

module.exports = router;
