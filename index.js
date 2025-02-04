require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 8000;
const Stripe = require("stripe");
// const emailRoutes = require("./routes/emails");

// Middleware
app.use(cors());
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

// MongoDB connection
const uri =
  "mongodb+srv://SERVER:VL4un3PMw9zc4enW@cluster0.s0sni.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection, parcelsCollection, deliveryMenCollection;

async function run() {
  try {
    // await client.connect();
    console.log(" Connected to MongoDB successfully!");

    const db = client.db("parcelManagement");
    usersCollection = db.collection("users");
    parcelsCollection = db.collection("parcels");
    deliveryMenCollection = db.collection("deliveryMen");
    // Statistics API
    app.get("/stats", async (req, res) => {
      try {
        const booked = await parcelsCollection.countDocuments({});
        const delivered = await parcelsCollection.countDocuments({
          status: "delivered",
        });
        const users = await usersCollection.countDocuments({});
        res.json({ booked, delivered, users });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ message: "Server Error" });
      }
    });
    app.get("/top-delivery-men", async (req, res) => {
      try {
        const topDeliveryMen = await deliveryMenCollection
          .aggregate([
            {
              $lookup: {
                from: "reviews",
                localField: "_id",
                foreignField: "deliveryManId",
                as: "reviews",
              },
            },
            {
              $addFields: {
                deliveredParcels: { $size: "$deliveredParcels" },
                averageRating: { $avg: "$reviews.rating" },
              },
            },
            { $sort: { deliveredParcels: -1, averageRating: -1 } },
            { $limit: 3 },
            {
              $project: {
                name: 1,
                image: 1,
                deliveredParcels: 1,
                averageRating: { $ifNull: ["$averageRating", 0] },
              },
            },
          ])
          .toArray();

        res.json(topDeliveryMen);
      } catch (error) {
        console.error("Error fetching top delivery men:", error);
        res.status(500).json({ message: "Server Error" });
      }
    });
    app.post("/register", async (req, res) => {
      const { name, email, profileImage, userType } = req.body;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser)
        return res.status(400).json({ message: "User already exists" });

      await usersCollection.insertOne({ name, email, profileImage, userType });
      res.json({ message: "User registered successfully" });
    });

    // Google Social Login
    app.post("/social-login", async (req, res) => {
      const { name, email, profileImage } = req.body;
      const existingUser = await usersCollection.findOne({ email });

      if (!existingUser) {
        await usersCollection.insertOne({
          name,
          email,
          profileImage,
          userType: "User",
        });
      }

      res.json({ message: "Social login successful" });
    });
    app.get("/user/:email", async (req, res) => {
      const { email } = req.params;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({ userType: user.userType });
    }); // Update Parcel (Only if status is pending)
    app.put("/update-parcel/:id", async (req, res) => {
      const { id } = req.params;
      const updatedParcel = req.body;

      const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
      if (!parcel || parcel.status !== "pending") {
        return res
          .status(400)
          .json({ message: "Only pending parcels can be updated." });
      }

      await parcelsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedParcel }
      );
      res.json({ message: "Parcel updated successfully" });
    });
    app.get("/stats", async (req, res) => {
      try {
        const bookings = await parcelsCollection
          .aggregate([
            { $group: { _id: "$bookingDate", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        res.json({
          bookingsByDate: {
            categories: bookings.map((b) =>
              new Date(b._id).toLocaleDateString()
            ),
            data: bookings.map((b) => b.count),
          },
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch statistics" });
      }
    });
    app.get("/all-parcels", async (req, res) => {
      try {
        const parcels = await parcelsCollection.find().toArray();
        res.json(parcels);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch parcels" });
      }
    });

    app.put("/assign-delivery/:id", async (req, res) => {
      const { id } = req.params;
      const { deliveryManId, deliveryDate } = req.body;

      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "On The Way",
              deliveryManId,
              approximateDeliveryDate: deliveryDate,
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.json({ message: "Delivery Man assigned successfully" });
        } else {
          res.status(400).json({ message: "Failed to assign delivery man" });
        }
      } catch (error) {
        res.status(500).json({ message: "Error assigning delivery man" });
      }
    });
    app.get("/search-parcels", async (req, res) => {
      const { startDate, endDate } = req.query;

      try {
        const query = {
          requestedDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        };

        const parcels = await parcelsCollection.find(query).toArray();
        res.json(parcels);
      } catch (error) {
        res.status(500).json({ message: "Failed to search parcels" });
      }
    });
    app.get("/delivery-men", async (req, res) => {
      try {
        const deliveryMen = await usersCollection
          .find({ userType: "DeliveryMen" })
          .toArray();
        res.json(deliveryMen);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch delivery men" });
      }
    });
    app.get("/all-users", async (req, res) => {
      try {
        const users = await usersCollection.find().limit(5).toArray();
        res.json(users);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });
    app.put("/promote-user/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { userType: role } }
        );

        if (result.modifiedCount > 0) {
          res.json({ message: `User promoted to ${role}` });
        } else {
          res.status(400).json({ message: "Failed to update user role" });
        }
      } catch (error) {
        res.status(500).json({ message: "Error updating user role" });
      }
    });
    app.get("/all-users-paginated", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 5;
      const skip = (page - 1) * limit;

      try {
        const users = await usersCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalUsers = await usersCollection.countDocuments();
        res.json({ users, totalUsers });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch paginated users" });
      }
    });
    app.get("/my-deliveries/:deliveryManId", async (req, res) => {
      try {
        const parcels = await parcelsCollection
          .find({ deliveryManId: req.params.deliveryManId })
          .toArray();
        res.json(parcels);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch deliveries" });
      }
    });
    app.put("/update-parcel-status/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.modifiedCount > 0) {
          res.json({ message: `Parcel marked as ${status}` });
        } else {
          res.status(400).json({ message: "Failed to update parcel status" });
        }
      } catch (error) {
        res.status(500).json({ message: "Error updating status" });
      }
    });
    app.get("/my-reviews/:deliveryManId", async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ deliveryManId: req.params.deliveryManId })
          .toArray();
        res.json(reviews);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch reviews" });
      }
    });
    app.post("/logout", async (req, res) => {
      try {
        res.clearCookie("authToken"); // Clear session if using cookies
        res.json({ message: "Logged out successfully" });
      } catch (error) {
        res.status(500).json({ message: "Logout failed", error });
      }
    });
    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ userType: user.userType || "User" }); // Ensure response contains userType
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ userType: user.userType || "User" }); // Ensure response contains userType
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
    // app.get("/stats", async (req, res) => {
    //   try {
    //     const bookedCount = await parcelsCollection.countDocuments({});
    //     const deliveredCount = await parcelsCollection.countDocuments({
    //       status: "delivered",
    //     });
    //     const userCount = await usersCollection.countDocuments({});

    //     res.json({
    //       booked: bookedCount,
    //       delivered: deliveredCount,
    //       users: userCount,
    //     });
    //   } catch (error) {
    //     res
    //       .status(500)
    //       .json({ message: "Error fetching stats", error: error.message });
    //   }
    // });
    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        console.log(" Fetching user from DB for email:", email);

        const user = await usersCollection.findOne({ email: email });
        console.log("🛠 Found User:", user); // Debugging output

        if (!user) {
          console.error(" User not found:", email);
          return res
            .status(404)
            .json({ message: "User not found", userType: null });
        }

        console.log(" Sending Response:", { userType: user.userType });
        res.json({ userType: user.userType || "User" });
      } catch (error) {
        console.error(" Error fetching user:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
    app.put("/cancel-parcel/:id", async (req, res) => {
      const { id } = req.params;
      console.log(" Cancelling Parcel:", id);

      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(id) }, //  Fix ObjectId issue
          { $set: { status: "canceled" } }
        );

        console.log(" Parcel Cancelled:", result);
        res.json({ success: true });
      } catch (error) {
        console.error(" Error Cancelling Parcel:", error);
        res.status(500).json({ error: "Failed to cancel parcel" });
      }
    });

    // Cancel Parcel (Only if status is pending)
    app.put("/cancel-parcel/:id", async (req, res) => {
      const { id } = req.params;

      const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
      if (!parcel || parcel.status !== "pending") {
        return res
          .status(400)
          .json({ message: "Only pending parcels can be canceled." });
      }

      await parcelsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "canceled" } }
      );
      res.json({ message: "Parcel canceled successfully" });
    });
    app.post("/book-parcel", async (req, res) => {
      try {
        const parcel = req.body;
        console.log("📦 New Parcel Booking Request:", parcel); // Debugging log

        if (
          !parcel.name ||
          !parcel.email ||
          !parcel.receiverName ||
          !parcel.address
        ) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // Insert into MongoDB collection
        const result = await parcelsCollection.insertOne(parcel);
        console.log(" Parcel successfully booked:", result.insertedId);

        res.status(201).json({
          message: "Parcel booked successfully",
          parcelId: result.insertedId,
        });
      } catch (error) {
        console.error(" Error booking parcel:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    app.get("/my-deliveries/:email", async (req, res) => {
      try {
        const { email } = req.params;

        // Find the delivery man by email
        const deliveryMan = await usersCollection.findOne({
          email,
          userType: "DeliveryMen",
        });

        if (!deliveryMan) {
          return res.status(404).json({ message: "Delivery Man not found" });
        }

        // Fetch parcels assigned to this delivery man
        const assignedParcels = await parcelsCollection
          .find({ deliveryManId: deliveryMan._id.toString() })
          .toArray();

        res.json(assignedParcels);
      } catch (error) {
        res.status(500).json({
          message: "Error fetching assigned parcels",
          error: error.message,
        });
      }
    });
    app.put("/assign-parcel/:parcelId", async (req, res) => {
      try {
        const { parcelId } = req.params;
        const { deliveryManId, approximateDeliveryDate } = req.body;

        // Validate Delivery Man Exists
        const deliveryMan = await usersCollection.findOne({
          _id: new ObjectId(deliveryManId),
          userType: "DeliveryMen",
        });

        if (!deliveryMan) {
          return res.status(404).json({ message: "Delivery Man not found" });
        }

        // Update Parcel
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              deliveryManId: deliveryMan._id.toString(),
              approximateDeliveryDate,
              status: "On The Way",
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.json({ message: "Parcel assigned successfully!" });
        } else {
          res.status(400).json({ message: "Failed to assign parcel" });
        }
      } catch (error) {
        res.status(500).json({
          message: "Error assigning delivery man",
          error: error.message,
        });
      }
    });

    app.get("/my-deliveries/:email", async (req, res) => {
      try {
        const { email } = req.params;

        // Find the delivery man by email
        const deliveryMan = await usersCollection.findOne({
          email,
          userType: "DeliveryMen",
        });

        if (!deliveryMan) {
          return res.status(404).json({ message: "Delivery Man not found" });
        }

        // Fetch parcels assigned to this delivery man
        const assignedParcels = await parcelsCollection
          .find({ deliveryManId: deliveryMan._id.toString() })
          .toArray();

        res.json(assignedParcels);
      } catch (error) {
        res.status(500).json({
          message: "Error fetching assigned parcels",
          error: error.message,
        });
      }
    });
    app.put("/assign-parcel/:parcelId", async (req, res) => {
      try {
        const { parcelId } = req.params;
        const { deliveryManId, approximateDeliveryDate } = req.body;

        // Validate Delivery Man Exists
        const deliveryMan = await usersCollection.findOne({
          _id: new ObjectId(deliveryManId),
          userType: "DeliveryMen",
        });

        if (!deliveryMan) {
          return res.status(404).json({ message: "Delivery Man not found" });
        }

        // Update Parcel
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              deliveryManId: deliveryMan._id.toString(),
              approximateDeliveryDate,
              status: "On The Way",
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.json({ message: "Parcel assigned successfully!" });
        } else {
          res.status(400).json({ message: "Failed to assign parcel" });
        }
      } catch (error) {
        res.status(500).json({
          message: "Error assigning delivery man",
          error: error.message,
        });
      }
    });
    app.get("/my-deliveries/:email", async (req, res) => {
      try {
        const { email } = req.params;

        // Find the delivery man by email
        const deliveryMan = await usersCollection.findOne({
          email,
          userType: "DeliveryMen",
        });

        if (!deliveryMan) {
          return res.status(404).json({ message: "Delivery Man not found" });
        }

        // Fetch parcels assigned to this delivery man
        const assignedParcels = await parcelsCollection
          .find({ deliveryManId: deliveryMan._id.toString() })
          .toArray();

        res.json(assignedParcels);
      } catch (error) {
        res.status(500).json({
          message: "Error fetching assigned parcels",
          error: error.message,
        });
      }
    });
    app.get("/my-deliveries/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const deliveries = await parcelsCollection
          .find({ deliveryManId: id })
          .toArray();
        res.json(deliveries);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch assigned deliveries" });
      }
    });
    app.put("/assign-parcel/:parcelId", async (req, res) => {
      const { parcelId } = req.params;
      const { deliveryManId, approximateDeliveryDate } = req.body;

      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              deliveryManId,
              approximateDeliveryDate,
              status: "On The Way",
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(400).json({ error: "Parcel assignment failed" });
        }

        res.json({ message: "Parcel assigned successfully" });
      } catch (error) {
        res.status(500).json({ error: "Error assigning parcel" });
      }
    });

    app.get("/my-parcels/:email", async (req, res) => {
      try {
        const email = req.params.email;
        console.log(" Fetching parcels for:", email);

        const parcels = await parcelsCollection
          .find({ email: email })
          .toArray();

        if (!parcels.length) {
          console.log(" No parcels found for:", email);
          return res.status(404).json({ message: "No parcels found" });
        }

        console.log(" Found Parcels:", parcels.length);
        res.json(parcels);
      } catch (error) {
        console.error(" Error fetching parcels:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        console.log(" Fetching user for email:", email);

        const user = await usersCollection.findOne({ email: email });

        if (!user) {
          console.error(" User not found in database:", email);
          return res
            .status(404)
            .json({ message: "User not found", userType: null });
        }

        console.log(" User Found:", user);
        res.json({
          userType: user.userType,
          name: user.name,
          photoURL: user.photoURL,
        });
      } catch (error) {
        console.error(" Error fetching user:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    app.put("/update-profile/:email", async (req, res) => {
      const { email } = req.params;
      const { name, photoURL } = req.body;

      try {
        const updatedUser = await usersCollection.findOneAndUpdate(
          { email },
          { $set: { name, photoURL } },
          { returnDocument: "after" }
        );

        res.json({
          message: "Profile updated successfully",
          user: updatedUser,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to update profile" });
      }
    });
    app.get("/my-reviews/:email", async (req, res) => {
      const { email } = req.params;
      console.log(" Fetching Reviews for:", email);

      try {
        const reviews = await reviewsCollection
          .find({ deliveryManEmail: email })
          .toArray();
        console.log(" Found Reviews:", reviews);
        res.json(reviews);
      } catch (error) {
        console.error(" Error Fetching Reviews:", error);
        res.status(500).json({ error: "Failed to fetch reviews" });
      }
    });
    app.get("/top-delivery-men", async (req, res) => {
      try {
        // Aggregation pipeline: Count parcels & calculate average rating
        const topDeliveryMen = await deliveryMenCollection
          .aggregate([
            {
              $lookup: {
                from: "parcels",
                localField: "email",
                foreignField: "deliveryManEmail",
                as: "parcels",
              },
            },
            {
              $lookup: {
                from: "reviews",
                localField: "email",
                foreignField: "deliveryManEmail",
                as: "reviews",
              },
            },
            {
              $addFields: {
                totalDelivered: { $size: "$parcels" },
                avgRating: {
                  $cond: {
                    if: { $gt: [{ $size: "$reviews" }, 0] },
                    then: { $avg: "$reviews.rating" },
                    else: 0,
                  },
                },
              },
            },
            { $sort: { totalDelivered: -1, avgRating: -1 } },
            { $limit: 3 },
            {
              $project: {
                _id: 1,
                name: 1,
                image: 1,
                totalDelivered: 1,
                avgRating: 1,
              },
            },
          ])
          .toArray();

        res.json(topDeliveryMen);
      } catch (error) {
        console.error(" Error fetching top delivery men:", error);
        res.status(500).json({ error: "Failed to fetch data" });
      }
    });

    //  Fetch all parcels
    //
  } catch (error) {
    console.error(" Error connecting to MongoDB:", error);
  }
}

// Run the database connection
run().catch(console.dir);

// Base Route
app.get("/", (req, res) => {
  res.send("🚀 Parcel Management API is running...");
});

// Start Server
app.listen(port, () => {
  console.log(` Server is running on http://localhost:${port}`);
});
