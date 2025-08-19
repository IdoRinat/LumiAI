import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "lumi_bot"; 
const COLLECTION_NAME = "chat_history"; 

async function flushChatHistory() {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const result = await collection.deleteMany({});
        console.log(`✅ Deleted ${result.deletedCount} chat history entries.`);

        await client.close();
    } catch (error) {
        console.error("❌ Error flushing history:", error);
    }
}

flushChatHistory();
