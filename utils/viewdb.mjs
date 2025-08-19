import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const client = new MongoClient(MONGO_URI);
const dbName = "lumi_bot";
const collectionName = "chat_history";

async function fetchChatHistory() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const chatHistory = await collection.find({}).toArray();
        console.log("Chat History:", JSON.stringify(chatHistory, null, 2));
    } catch (error) {
        console.error("Error fetching chat history:", error);
    } finally {
        await client.close();
    }
}

fetchChatHistory();
