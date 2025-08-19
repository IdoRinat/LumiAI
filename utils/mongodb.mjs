// mongodb.mjs
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = "mongodb://localhost:27017";
const client = new MongoClient(MONGO_URI);
const dbName = "lumi_bot";
const collectionName = "chat_history";

async function connectDB() {
    if (!client.topology || !client.topology.isConnected()) {
        await client.connect();
    }
    return client.db(dbName).collection(collectionName);
}

const LUMI_ID = "LumiAI";  

export async function getChatHistory(userId) {
    const collection = await connectDB();
    const history = await collection
        .find({ $or: [{ userId }, { userId: "LumiAI" }] })
        .sort({ timestamp: 1 }) // Ensure messages are in correct order
        .limit(10) // Get up to 10 messages for better context
        .toArray();

    // Use a regex to check if the message is already in dialogue format.
    return history.map(msg => {
         const trimmed = msg.content.trim();
         const dialogueRegex = /^\[[^\]]+\]:\s*/;
         if (dialogueRegex.test(trimmed)) {
             // Message is already formatted (e.g., "[Falcon]: I loom me")
             return trimmed;
         } else {
             // Otherwise, format based on the userId
             if (msg.userId === "LumiAI") {
                 return `[Lumi]: ${trimmed}`;
             } else {
                 return `[Falcon]: ${trimmed}`;
             }
         }
    });
}

// ✅ Save a message without any added labels
export async function saveChatHistory(userId, role, content) {
    const collection = await connectDB();
    await collection.insertOne({
        userId,
        role,
        content,
        timestamp: new Date(),
    });
}
