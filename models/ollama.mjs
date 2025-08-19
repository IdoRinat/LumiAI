import fetch from "node-fetch";
import dotenv from "dotenv";
import { getChatHistory, saveChatHistory } from "../utils/mongodb.mjs";

dotenv.config();

const systemPrompt = process.env.SYSTEM_PROMPT;
const max_tokens = 60;
const OLLAMA_API_URL = process.env.OLLAMA_API_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const MAX_WORDS = 25;

export async function chatWithOllama(userId, userMessage) {
    try {
        const history = await getChatHistory(userId);

        const usernameMatch = userMessage.match(/^\[([^\]]+)\]:/);
        const username = usernameMatch ? usernameMatch[1] : userId;
        const formattedUserMessage = usernameMatch 
            ? userMessage.trim() 
            : `[${username}]: ${userMessage.trim()}`;
        const modifiedPrompt = `${systemPrompt}

    ### Response Length Rules:
    - Lumi can only respond in short, direct sentences.
    - The response must NOT exceed ${MAX_WORDS} words.
    - No long explanations, only quick replies.
    `;

        const messages = [
            { role: "system", content: modifiedPrompt },
            ...history,
            formattedUserMessage
        ];

        const formattedPrompt = messages
        .map(msg => typeof msg === "string" ? msg : msg.content)
        .filter(msg => msg)
        .join("\n") + "\n[Lumi]: ";    

        console.log("🔹 Sending to Ollama:\n" + formattedPrompt);

        const res = await fetch(OLLAMA_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                model: OLLAMA_MODEL, 
                prompt: formattedPrompt, 
                max_tokens: max_tokens,
                temperature: 0.3,
                top_p: 0.5,
                keep_alive: 100
            }),                       
        });

        const rawResponse = await res.text();
        let finalResponse = "";

        try {
            const jsonLines = rawResponse.trim().split("\n");
            for (const line of jsonLines) {
                const jsonData = JSON.parse(line);
                if (jsonData.response) {
                    finalResponse += jsonData.response;
                }
            }
        } catch (e) {
            console.error("❌ Error parsing Ollama response:", e);
            return "ERROR PARSING OLLAMA RESPONSE";
        }

        const words = finalResponse.split(/\s+/);
        if (words.length > MAX_WORDS) {
            finalResponse = words.slice(0, MAX_WORDS).join(" ") + "...";
        }

        console.log("💬 Ollama Response:", finalResponse);

        await saveChatHistory(userId, "user", userMessage);
        await saveChatHistory("LumiAI", "assistant", finalResponse);

        return finalResponse;
    } catch (error) {
        console.error("❌ Error calling Ollama:", error);
        return "I didn't quite get that.";
    }
}
