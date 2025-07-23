const express = require('express');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const diff = require('diff');
const { spawn, exec } = require('child_process');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const app = express();
const port = 8998;

let baseSchema = {};
(async () => {
    try {
        baseSchema = JSON.parse(await fs.readFile('./public/schema.json', 'utf8'));
    } catch (error) {
        console.error('Error reading base schema file:', error);
    }
})();

app.use(express.json({ limit: '500mb' }));

// In-memory storage for schemas
const storedSchemas = [];

const backupDir = './backups';

// Ensure backup directory exists
(async () => {
    try {
        await fs.mkdir(backupDir, { recursive: true });
    } catch (error) {
        console.error('Error creating backup directory:', error);
    }
})();

// Function to create a backup
const createBackup = async () => {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, ''); // YYYY-MM-DDTHH-mm-ss
    const fileName = `${backupDir}/schemas_backup_${timestamp}.json`;
    try {
        await fs.writeFile(fileName, JSON.stringify(storedSchemas, null, 2));
        console.log(`Server data backed up to ${fileName}`);
        await cleanOldBackups();
    } catch (err) {
        console.error('Error writing backup file:', err);
    }
};

// Function to clean old backups, keeping only the last 24
const cleanOldBackups = async () => {
    try {
        const files = await fs.readdir(backupDir);
        const backupFiles = [];
        for (const file of files) {
            if (file.startsWith('schemas_backup_') && file.endsWith('.json')) {
                const stats = await fs.stat(`${backupDir}/${file}`);
                backupFiles.push({ name: file, time: stats.mtime.getTime() });
            }
        }
        backupFiles.sort((a, b) => b.time - a.time); // Sort by modification time, newest first

        if (backupFiles.length > 24) {
            for (let i = 24; i < backupFiles.length; i++) {
                const fileToDelete = `${backupDir}/${backupFiles[i].name}`;
                try {
                    await fs.unlink(fileToDelete);
                    console.log(`Deleted old backup file: ${fileToDelete}`);
                } catch (err) {
                    console.error(`Error deleting old backup file ${fileToDelete}:`, err);
                }
            }
        }
    } catch (err) {
        console.error('Error reading backup directory:', err);
    }
};

// Function to load the latest backup on server start
const loadLatestBackup = async () => {
    try {
        const files = await fs.readdir(backupDir);
        const backupFiles = [];
        for (const file of files) {
            if (file.startsWith('schemas_backup_') && file.endsWith('.json')) {
                const stats = await fs.stat(`${backupDir}/${file}`);
                backupFiles.push({ name: file, time: stats.mtime.getTime() });
            }
        }
        backupFiles.sort((a, b) => b.time - a.time); // Sort by modification time, newest first

        if (backupFiles.length > 0) {
            const latestBackup = `${backupDir}/${backupFiles[0].name}`;
            try {
                const backupData = JSON.parse(await fs.readFile(latestBackup, 'utf8'));
                storedSchemas.splice(0, storedSchemas.length, ...backupData); // Clear and replace with backup data
                console.log(`Loaded latest backup from ${latestBackup}`);
                lastRestoreTimestamp = new Date().toISOString();
                console.log('Server has been reverted to the state of this backup.');
            } catch (error) {
                console.error(`Error loading backup file ${latestBackup}:`, error);
                lastRestoreTimestamp = null; // Ensure it's null if loading fails
            }
        } else {
            console.log('No existing backups found. Starting with an empty state.');
            lastRestoreTimestamp = null; // Ensure it's null if no backups exist
        }
    } catch (err) {
        console.error('Error reading backup directory:', err);
    }
};

// Endpoint to save a schema
app.post('/api/schemas', (req, res) => {
    const { id, name, filledSchema } = req.body;
    if (!id || !name || !filledSchema) {
        return res.status(400).json({ error: 'id, name, and filledSchema are required' });
    }
    // Check if schema with same ID already exists and update it
    const existingIndex = storedSchemas.findIndex(s => s.id === id);
    if (existingIndex > -1) {
        storedSchemas[existingIndex] = { id, name, filledSchema };
        console.log(`Updated schema with ID: ${id}`);
    } else {
        storedSchemas.push({ id, name, filledSchema });
        console.log(`Saved new schema with ID: ${id}`);
    }
    res.status(200).json({ message: 'Schema saved successfully' });
});

// Endpoint to get all schemas
app.get('/api/schemas', (req, res) => {
    res.status(200).json(storedSchemas);
});

// Endpoint to delete all schemas
app.delete('/api/schemas', (req, res) => {
    storedSchemas.length = 0; // Clear the array
    console.log('All schemas deleted from server memory.');
    res.status(200).json({ message: 'All schemas deleted successfully' });
});

// Endpoint to delete a single schema by ID
app.delete('/api/schemas/:id', (req, res) => {
    const { id } = req.params;
    const schemaIndex = storedSchemas.findIndex(s => s.id == id);

    if (schemaIndex > -1) {
        storedSchemas.splice(schemaIndex, 1);
        console.log(`Deleted schema with ID: ${id}`);
        res.status(200).json({ message: 'Schema deleted successfully' });
    } else {
        res.status(404).json({ error: 'Schema not found' });
    }
});

app.post('/api/batch-schemas', async (req, res) => {
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ error: 'File content is required' });
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Given the following text, please split it into a list of distinct descriptions for creating separate event schemas. Each description should be a self-contained unit. Return the descriptions as a JSON array of strings. For example, if the input is "Create a schema for a user profile with name and email. Also, create a schema for a product with name and price.", the output should be ["Create a schema for a user profile with name and email.", "Create a schema for a product with name and price."]. Input text: ${content}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        const descriptions = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        const newChats = [];

        for (const description of descriptions) {
            const newChat = {
                id: Date.now() + Math.random(),
                name: `New Event`,
                messages: [{ role: 'user', content: description }],
                schema: JSON.stringify(baseSchema, null, 2),
                filledSchema: null,
                isNew: true
            };

            const schemaResponse = await generateSchemaForPrompt(newChat.schema, description, newChat.messages);
            if (schemaResponse.action === 'update_schema') {
                const { schema, explanation } = schemaResponse.payload;
                let eventName = newChat.name;
                if (schema && (schema.event_label || schema.event_name)) {
                    const rawEventName = schema.event_label || schema.event_name;
                    eventName = rawEventName
                        .split('_')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                }
                newChat.name = eventName;
                newChat.filledSchema = schema || null;
                newChat.messages.push({ role: 'assistant', content: explanation });
            }
            newChats.push(newChat);
        }

        res.status(200).json(newChats);
    } catch (error) {
        console.error('Error during batch schema creation:', error);
        res.status(500).json({ error: 'Failed to process batch schema creation' });
    }
});

async function generateSchemaForPrompt(schema, prompt, conversationHistory) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const systemPrompt = `
You are an intelligent assistant for generating and refining JSON schemas and modifying code. Your goal is to help the user create a valid JSON object based on a provided schema, answer questions, or modify code.
You have three main capabilities:
1.  **Update Schema**: If the user's prompt is asking to fill, modify, or update the JSON schema, you will return a valid JSON object.
2.  **Answer Question**: If the user is asking a question, seeking clarification, or having a conversation that does not involve changing the schema or code, you will provide a helpful text-based answer.
3.  **Code Agent**: If the user's prompt is about directly modifying code that doesn't have to do with logging or involves editing code, or something that seems to imply it (not related to logging-for stuff that seems ambiguous still assume the user wants to create a schema for that event), you will call the appropriate CLI to modify code.

Analyze the user's prompt and the conversation history to determine the correct action.

**Response Format:**
You MUST respond with a JSON object containing two fields: "action" and "payload".
-   If you are updating the schema, the format is:
    \`\`\`json
    {
      "action": "update_schema",
      "payload": {
        "schema": { ... the new JSON object ... },
        "explanation": "A brief explanation of the changes you made."
      }
    }
    \`\`\`
-   If you are answering a question, the format is:
    \`\`\`json
    {
      "action": "answer_question",
      "payload": {
        "answer": "Your helpful and informative answer."
      }
    }
    \`\`\`
- If you are calling the code agent, the format is:
    \`\`\`json
    {
        "action": "code_agent",
        "payload": {
            "prompt": "The user's prompt to be sent to the code agent.",
            "explanation": "A brief explanation of what you are about to do. Assume code agent is a part of you, so just return like Adding ___ to ___..."
        }
    }
    \`\`\`

**IMPORTANT:**
-   When updating the schema, ensure the output is a single, valid JSON object. Do not include any extra text or markdown formatting around the JSON payload.
-   The \`payload.schema\` should be the complete, filled-out JSON object. Do not include the provided structure (if applicable) in your response; only return the filled out information. If an applicable schema is already given, only modify and give the modified result
-   Base your response on the provided schema and the user's latest prompt.
**Current Schema: If this is a structure describing the format, create a json in this format. Otherwise, only make minor updates to it. DO NOT INCLUDE THE PROVIDED SAMPLE STRUCTURE IN YOUR RESPONSE.**
${schema}
**Conversation History:**
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}
**User's Prompt:**
${prompt}
If calling code agent, DO NOT SAY YOU CANNOT MODIFY CODE, BECAUSE YOU CAN BY RUNNING CODE AGENT. The code is provided directly to code agent, not you. Just forward user's request directly to code agent.
`;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const text = response.text();
    const jsonResponse = text.replace(/```json\n/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonResponse);
}

app.post('/api/generate', async (req, res) => {
    try {
        const { schema, prompt, conversationHistory } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const result = await generateSchemaForPrompt(schema, prompt, conversationHistory);
        res.json(result);
    } catch (error) {
        console.error('Error generating response:', error);
        res.status(500).json({ error: 'Failed to generate response' });
    }
});

app.post('/api/code-agent', async (req, res) => {
    const { prompt, files, useClaude, useCli } = req.body;

    if (!prompt || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Prompt and an array of files are required' });
    }

    const userFilesDir = path.join(__dirname, 'USER_FILES');
    const originalFileContents = new Map();

    try {
        await fs.rm(userFilesDir, { recursive: true, force: true });
        await fs.mkdir(userFilesDir, { recursive: true });

        for (const file of files) {
            const normalizedFilePath = file.filePath.replace(/\\/g, '/');
            originalFileContents.set(normalizedFilePath, file.content);
            const filePath = path.join(userFilesDir, file.filePath);
            const dirName = path.dirname(filePath);
            await fs.mkdir(dirName, { recursive: true });
            await fs.writeFile(filePath, file.content);
        }

        let cliCommand, cliName, cliArgs;
        if (useClaude) {
            cliName = 'Claude';
            cliCommand = 'claude';
            cliArgs = ['--dangerously-skip-permissions', `-p "${prompt}"`];
        } else {
            cliName = 'Gemini';
            cliCommand = 'gemini';
            cliArgs = ['--yolo', `-p "${prompt}"`];
        }

        console.log(`Initializing ${cliName} CLI for ${prompt}`);
        let stdoutData = '';
        let stderrData = '';
        const child = spawn(cliCommand, cliArgs, {
            cwd: userFilesDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
            env: process.env,
        });

        res.setHeader('Content-Type', 'application/json');

        child.stdout.on('data', chunk => {
            const str = chunk.toString();
            const lines = str.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                res.write(JSON.stringify({ stdout: line }) + '\n');
            }
        });

        child.stderr.on('data', chunk => {
            const str = chunk.toString();
            console.error(`[${cliName} stderr]`, str);
        });

        child.on('error', err => {
            console.error(`Failed to start ${cliName}:`, err);
            if (!res.headersSent) {
                res.status(500).json({
                    message: `Could not spawn ${cliName} process`,
                    error: err.message,
                });
            }
        });

        child.on('close', async code => {
            console.log(`${cliName} exited with code ${code}`);

            if (code !== 0) {
                if (!res.headersSent) {
                    res.status(500).json({
                        message: `${cliName} process exited with an error`,
                        exitCode: code,
                    });
                }
                res.end();
                return;
            }

            const modifiedFiles = [];
            const getAllFiles = async (dirPath, fileList = []) => {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        await getAllFiles(fullPath, fileList);
                    } else {
                        fileList.push(fullPath);
                    }
                }
                return fileList;
            };

            const allFilePaths = await getAllFiles(userFilesDir);

            for (const filePath of allFilePaths) {
                const relativePath = path.relative(userFilesDir, filePath).replace(/\\/g, '/');
                const originalContent = originalFileContents.get(relativePath);
                const newContent = await fs.readFile(filePath, 'utf8');

                if (originalContent !== newContent) {
                    modifiedFiles.push({
                        filePath: relativePath,
                        modifiedContent: newContent,
                    });
                }
            }

            res.write(JSON.stringify({ modifiedFiles: modifiedFiles }) + '\n');
            res.end();
        });

    } catch (error) {
        console.error('Error processing code-agent request:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: `Failed to process request: ${error.message}` });
        }
    }
});

app.post('/api/backup-server', (req, res) => {
    createBackup(); // Call the backup function
    res.status(200).json({ message: 'Server data backed up successfully' });
});

app.post('/api/generate-report', async (req, res) => {
    const { files, baseDirPath, useClaude, useCli } = req.body;
        const prompt = `Generate a comprehensive event coverage percentage report (markdown file) analyzing the gap between the 'Novo Mobile Analytics Spec.xlsx' specification and current Android codebase implementation.   Critical Requirements:   1. Use ONLY Automated Search - No Manual Estimation   - MANDATORY: Use the comprehensive automated search methodology documented in previous reports  - Never rely on manual estimation - it severely underestimated coverage (49% manual vs 79% automated)  - Use exact string matching with grep: grep -r 'EventName' /path/to/codebase --include='*.kt'   2. Specification Parsing Requirements   # CRITICAL: Handle Excel formatting properly  import openpyxl   # For Interaction Events - MUST check for strikethrough  for row_num in range(2, interaction_sheet.max_row + 1):      cell = interaction_sheet.cell(row=row_num, column=1)      if cell.value and not (cell.font and cell.font.strike):  # Skip deprecated events          # Process valid events only   # For SafeStart Events - Parse numbered events 1-39  # Look for event_label rows to get actual event names   3. Search Scope   - Tables: ONLY 'Interaction Events' and 'Safe Start' tables from Excel  - Exclude: Deprecated events marked with strikethrough formatting  - Include: All valid events regardless of implementation location  - Search Pattern: 'ExactEventName' in quotes to avoid false positives   4. Expected Results Format   # Event Coverage Report  - Total Specification Events: 187 (148 Interaction + 39 SafeStart)  - Implemented Events: XXX of 187 (XX% coverage)  - Interaction Events: XXX/148 (XX%)  - SafeStart Events: XXX/39 (XX%)  - Deprecated Events: 3 notification events (excluded from calculations)   5. Key Success Criteria   - ✅ Must identify 140+ implemented events (not ~50-60 from manual search)  - ✅ Include file locations for verification (e.g., SetupScreen_Started in MobileNspIntroViewModel.kt)  - ✅ Handle multi-platform implementations (Firebase, Mixpanel, AppsFlyer)  - ✅ Exclude strikethrough events from coverage calculations   6. Common Pitfalls to Avoid   - ❌ Manual counting/estimation → leads to severe underestimation  - ❌ Ignoring strikethrough formatting → inflates missing event count  - ❌ Limited search scope → misses events in unexpected ViewModels  - ❌ Not handling duplicates → incorrect specification counts  - ❌ Missing AppsFlyer-only events → undercounts SafeStart implementations   7. Validation Checkpoints   1. Specification count: Should be 187 total events (not 190+)  2. Found events: Should find 140+ events (not <100)  3. Key events verification: Must find SetupScreen_Started, Where_Is_Quote_Clicked, Signup_Success  4. Deprecated handling: Must exclude 3 notification events with strikethrough   8. Report Structure Requirements   - Methodology section with automated search script  - Coverage breakdown by category (Interaction vs SafeStart)  - Implementation verification with file locations  - Missing events analysis (should be less than~50 events, not 90+)  - Future-proofing: Include search methodology for replication   Expected outcome: Accurate xx% coverage report with xx of 187 events implemented, demonstrating excellent analytics implementation across the Novo Mobile Android application.  `.replace(/\r?\n/g, ' ');

    if (!files || !baseDirPath) {
        return res.status(400).json({ message: 'Files and base directory path are required' });
    }

    try {
        let cliCommand, cliName, cliArgs;
        if (useClaude) {
            cliName = 'Claude';
            cliCommand = 'claude';
            cliArgs = ['--dangerously-skip-permissions', `-p "${prompt}"`];
        } else {
            cliName = 'Gemini';
            cliCommand = 'gemini';
            cliArgs = ['--yolo', `-p "${prompt}"`];
        }

        console.log(`Spawning command: ${cliCommand} ${cliArgs.join(' ')}`);
        const child = spawn(cliCommand, cliArgs, {
            shell: true,
            env: { ...process.env, USE_CLAUDE: useClaude.toString() }
        });

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
            console.log(`CLI stdout: ${data.toString()}`);
            stdoutData += data.toString();
        });

        child.stderr.on('data', (data) => {
            console.error(`CLI stderr: ${data.toString()}`);
            stderrData += data.toString();
        });

        child.on('close', (code) => {
            console.log(`CLI process exited with code ${code}`);
            if (code === 0) {
                res.status(200).json({ message: 'Report generated successfully!', stdout: stdoutData, stderr: stderrData });
            } else {
                res.status(500).json({ message: `CLI process exited with code ${code}`, stdout: stdoutData, stderr: stderrData });
            }
        });

        child.on('error', (err) => {
            console.error(`Failed to spawn CLI process: ${err.message}`);
            res.status(500).json({ message: `Failed to spawn CLI process: ${err.message}` });
        });

    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ message: 'Failed to generate report' });
    }
});

app.post('/api/inject-logging', async (req, res) => {
    console.log("Pinged")
    const { schema, files, baseDirPath } = req.body;

    if (!schema || !files || !Array.isArray(files)) {
        return res.status(400).json({ error: 'Schema and an array of files are required' });
    }

    let filesToSendToGemini = files; // Default to all files

    // Check for existence of 'domain' or 'ui' folders anywhere in the file paths
    const hasDomainOrUi = files.some(file => file.filePath.includes('/domain/') || file.filePath.includes('/ui/'));

    if (hasDomainOrUi) {
        // Step 1: Send instructions/file structure to Gemini to get relevant folders
        const fullFileStructure = files.map(file => file.filePath).join('\n');

        let initialPrompt = `You are an AI assistant that helps identify relevant parts of a codebase for injecting logging functionality.\nGiven the following file structure of a codebase, identify the subfolders under *any* 'domain/' and 'ui/' directories that are most likely relevant for injecting logging based on this schema: ${JSON.stringify(schema, null, 2)}
You should only return the relative paths of these relevant subfolders, one per line. Do not include files directly under 'domain/' or 'ui/' directories, only their subfolders.\nIf no subfolders are relevant, return an empty array.\n\nExample Output:\n[\n  "src/domain/users/models",\n  "frontend/ui/components/buttons"\n]\n\nFile Structure:\n\`\`\`\n${fullFileStructure}\n\`\`\`\n`;
        initialPrompt = initialPrompt.replace("\"", "\'")
try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Using a capable model for this step
            const result = await model.generateContent(initialPrompt);
            const response = await result.response;
            const text = response.text();

            let relevantFolders = [];
            try {
                relevantFolders = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
                if (!Array.isArray(relevantFolders)) {
                    relevantFolders = []; // Ensure it's an array
                }
                console.log(relevantFolders)
            } catch (parseError) {
                console.warn('Gemini did not return a valid JSON array for relevant folders. Proceeding with all files.', parseError);
                relevantFolders = []; // Fallback to empty if parsing fails
            }

            // Step 2: Prune the codebase based on relevant folders
            if (relevantFolders.length > 0) {
                filesToSendToGemini = files.filter(file => {
                    const relativeFilePath = file.filePath;
                    // Keep files directly under *any* 'domain/' or 'ui/' directory
                    const isDirectlyUnderDomainOrUi = (relativeFilePath.includes('/domain/') && relativeFilePath.split('/domain/')[1].split('/').length === 1) ||
                                                      (relativeFilePath.includes('/ui/') && relativeFilePath.split('/ui/')[1].split('/').length === 1);

                    if (isDirectlyUnderDomainOrUi) {
                        return true;
                    }

                    // Keep files within identified relevant subfolders
                    return relevantFolders.some(folder => relativeFilePath.startsWith(folder + '/'));
                });
                console.log(`Pruned codebase to ${filesToSendToGemini.length} files based on Gemini's recommendations.`);
            } else {
                console.log('No relevant folders identified by Gemini. Proceeding with full codebase.');
            }

        } catch (error) {
            console.error('Error during initial Gemini call for folder identification:', error);
            // Fallback to sending the entire codebase if the initial Gemini call fails
            console.log('Falling back to full codebase due to error in folder identification.');
        }
    } else {
        console.log('Neither "domain" nor "ui" folders found. Proceeding with full codebase.');
    }

    // Step 3: Proceed with the main Gemini call using the (potentially pruned) files
    const fileStructureForMainPrompt = filesToSendToGemini.map(file => file.filePath).join('\n');

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `You are an AI assistant that helps inject logging functionality into existing codebases. Given a JSON schema, and the contents of its files, you need to generate the necessary code to log data conforming to the schema and integrate it into the correct file(s). The generated code should be idiomatic for the language and framework detected in the file. You must return an array of objects, where each object contains the 'filePath' (relative to the project root) and its 'modifiedContent'. 
        Only include files that you have modified. If no files are modified, return an empty array.\n\nJSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\nFile Structure of the Codebase:\n\`\`\`\n${fileStructureForMainPrompt}\n\`\`\`\n\nContents of Files:\n\`\`\`json\n${JSON.stringify(filesToSendToGemini, null, 0)}\n\`\`\`\n\nInstructions:\n1. Analyze the file structure and contents to identify the most appropriate file(s) for injecting logging functionality. Consider where the data relevant to the schema would be generated or processed.\n2. Generate code that, when inserted into the target file(s), will:\n    - Define a logging function or mechanism that accepts data conforming to the provided schema.\n3. Return an array of JSON objects. Each object must have a 'filePath' (relative to the project root) and 'modifiedContent' field. Only include files that you have modified. If no files are modified, return an empty array.\n\nExample of expected output format:\n\`\`\`json\n[\n  {\n    "filePath": "src/utils/logger.js",\n    "modifiedContent": "// Original content of logger.js\n\nfunction logEvent(data) {\n  console.log('Logging event:', data);\n}\n\n// Example usage\nlogEvent({\n  // ... sample data based on schema ...\n});\n"\n  },\n  {\n    "filePath": "src/components/SomeComponent.js",\n    "modifiedContent": "// Original content of SomeComponent.js\n\n// ... some code ...\n\n// Call the logging function\nlogEvent({\n  // ... relevant data from component ...\n});\n"\n  }\n]\n\`\`\`\n\nNow, provide the array of modified file contents.`
        console.log(prompt.length)
        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log(response.usageMetadata)
        const text = response.text();
        // console.log(response.text())

        const modifiedFiles = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

        res.status(200).json({ message: 'Logging functionality processed. Please check your local folder for changes.', modifiedFiles: modifiedFiles });

    } catch (error) {
        console.error('Error injecting logging:', error);
        res.status(500).json({ error: `Failed to inject logging: ${error.message}` });
    }
});

app.post('/api/inject-novo', async (req, res) => {
    console.log("Pinged Novo");
    const { schema, files, baseDirPath } = req.body;

    if (!schema || !files || !Array.isArray(files)) {
        return res.status(400).json({ error: 'Schema and an array of files are required' });
    }

    try {
        // Step 1: Collect all XML files within res/layout from the provided files
        const layoutXmlFiles = files.filter(file => {
            const normalizedPath = file.filePath.replace('/\\/g', '/'); // Normalize path separators
            return normalizedPath.includes('res/layout/') && normalizedPath.endsWith('.xml');
        });

        if (layoutXmlFiles.length === 0) {
            return res.status(404).json({ message: 'No XML files found in res/layout within the provided files.' });
        }

        const xmlFilenames = layoutXmlFiles.map(file => file.filePath);

        // Step 2: Send XML filenames to Gemini to select the most likely file
        const selectXmlPrompt = `Given the following JSON schema and a list of XML layout filenames, which XML file is most likely related to the event described by the schema? Return only the relative path of the most relevant XML file. If none are relevant, return an empty string.\n\nJSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\nXML Layout Files:\n${xmlFilenames.join('\n')}\n\nReturn the most relevant XML file only and nothing else.`


        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(selectXmlPrompt);
        const response = await result.response;
        const selectedXmlFileRelativePath = response.text().trim();
        console.log(selectedXmlFileRelativePath)

        if (!selectedXmlFileRelativePath) {
            return res.status(400).json({ message: 'Gemini could not identify a relevant XML file.' });
        }

        const selectedXmlFile = files.find(file => file.filePath === selectedXmlFileRelativePath);
        if (!selectedXmlFile) {
            return res.status(404).json({ message: `Selected XML file not found in provided files: ${selectedXmlFileRelativePath}` });
        }

        // Step 3: Process the selected XML file content
        const selectedXmlFileContent = selectedXmlFile.content;

        // Step 4: Ask Gemini to return the file the appropriate onclick command is located in
        const findOnclickFilePrompt = `Given the following XML layout file content and a JSON schema, identify the source file (likely fragment) that contains the implementation for the 'android:onClick' attribute or any other event handling logic related to the UI elements in this XML. Also, extract the value of the 'android:onClick' attribute if present in the XML. Return a JSON object with 'filePath' and 'onclickFunction'. If no such file or onclick function can be determined, return an empty string for the respective field.\n\nJSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\nXML File Content:\n\`\`\`xml\n${selectedXmlFileContent}\n\`\`\`\nReturn only json in the following format:\n\`\`\`json\n{\n  \"filePath\": \"path/to/YourActivity.kt\",\n  \"onclickFunction\": \"onButtonClick\"\n}\n\`\`\`\n\nReturn the JSON object only. Note the fragment (source) file should only be kotlin, so use .kt file extensions. The path should be as referenced in the XML, starting from com`;
        const onclickFileResult = await model.generateContent(findOnclickFilePrompt);
        const onclickFileResponse = await onclickFileResult.response;
        const onclickResponseText = onclickFileResponse.text().trim();
        console.log(onclickResponseText);
        
        let onclickInfo;
        try {
            onclickInfo = JSON.parse(onclickResponseText.replace(/```json/g, '').replace(/```/g, '').trim());
        } catch (parseError) {
            console.error('Error parsing Gemini response for onclick info:', parseError);
            return res.status(500).json({ message: 'Failed to parse Gemini response for onclick information.' });
        }
        
        const onclickFileRelativePath = 'java/' + onclickInfo.filePath;
        const onclickFunctionName = onclickInfo.onclickFunction;
        
        if (!onclickFileRelativePath) {
            return res.status(400).json({ message: 'Gemini could not identify the onclick implementation file.' });
        }
        const onclickFile = files.find(file => file.filePath.includes(onclickFileRelativePath));
        if (!onclickFile) {
            return res.status(404).json({ message: `Onclick implementation file not found in provided files: ${onclickFileRelativePath}` });
        }

        // Step 5: Read the onclick file content
        const onclickFileContent = onclickFile.content;

        // Step 6: Send this file to the agent to implement the logging
        const injectLoggingPrompt = `You are an AI assistant that helps inject logging functionality into existing codebases. Given a JSON schema, the content of a source file, and the name of an onclick function (if applicable), you need to generate the necessary code to log data conforming to the schema and integrate it into the appropriate location within this file. The generated code should be idiomatic for the language and framework detected in the file. You must return an array of objects, where each object contains the 'filePath' (relative to the project root) and its 'modifiedContent'. Only include files that you have modified. If no files are modified, return an empty array.\n\nJSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\nSource File Path: ${onclickFileRelativePath}\n\nSource File Content:\n\`\`\`\n${onclickFileContent}\n\`\`\`\n\nOnclick Function Name (if applicable): ${onclickFunctionName || 'N/A'}\n\nInstructions:\n1. Analyze the source file content, the JSON schema, and the onclick function name (if provided) to identify the most appropriate location to inject logging code. This will likely be within the specified onclick function or another relevant event handler or function that processes user interaction related to the schema.\n2. Generate code that, when inserted into the target file, will:\n    - Log data conforming to the provided schema.\n3. Return an array of JSON objects. Each object must have a 'filePath' (relative to the project root) and 'modifiedContent' field. Only include files that you have modified. If no files are modified, return an empty array.\n\nExample of expected output format:\n\`\`\`json\n[\n  {\n    "filePath": "${onclickFileRelativePath}",\n    "modifiedContent": "// Original content with injected logging\n"\n  }\n]\n\`\`\`\n\nNow, provide the array of modified file contents.`

        const finalLoggingResult = await model.generateContent(injectLoggingPrompt);
        const finalLoggingResponse = await finalLoggingResult.response;
        const modifiedFiles = JSON.parse(finalLoggingResponse.text().replace(/```json/g, '').replace(/```/g, '').trim());
        console.log('Modified files sent to client:', JSON.stringify(modifiedFiles, null, 2));

        res.status(200).json({ message: 'Novo logging functionality processed.', modifiedFiles: modifiedFiles });

    } catch (error) {
        console.error('Error in inject-novo endpoint:', error);
        res.status(500).json({ error: `Failed to process Novo logging: ${error.message}` });
    }
});



app.post('/api/cli-inject', async (req, res) => {
    const { schema, files, useClaude } = req.body;

    if (!schema || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Schema and an array of files are required' });
    }

    const userFilesDir = path.join(__dirname, 'USER_FILES');
    const originalFileContents = new Map();

    try {
        // Store original contents and write files
        await fs.rm(userFilesDir, { recursive: true, force: true });
        await fs.mkdir(userFilesDir, { recursive: true });

        for (const file of files) {
            const normalizedFilePath = file.filePath.replace(/\\/g, '/');
            originalFileContents.set(normalizedFilePath, file.content);
            const filePath = path.join(userFilesDir, file.filePath);
            const dirName = path.dirname(filePath);
            await fs.mkdir(dirName, { recursive: true });
            await fs.writeFile(filePath, file.content);
        }

        // Find main and CLAUDE.md
        let mainFolderPath;
        const findMain = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'main' && path.basename(path.dirname(fullPath)) === 'src') {
                        mainFolderPath = fullPath;
                        return;
                    }
                    if (!mainFolderPath) await findMain(fullPath);
                }
            }
        };
        await findMain(userFilesDir);

        if (!mainFolderPath) {
            return res.status(404).json({ error: "Could not find 'main' directory under a 'src' directory." });
        }

        let claudeFilePath;
        const findClaude = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await findClaude(fullPath);
                } else if (entry.name === 'CLAUDE.md') {
                    if (!claudeFilePath || fullPath.split(path.sep).length < claudeFilePath.split(path.sep).length) {
                        claudeFilePath = fullPath;
                    }
                }
            }
        };
        await findClaude(userFilesDir);

        // if (claudeFilePath) {
        //     const claudeContent = await fs.readFile(claudeFilePath, 'utf8');
        //     const geminiContent = claudeContent.split('\n').filter(line => !line.toLowerCase().includes('claude')).join('\n');
        //     const geminiFilePath = path.join(mainFolderPath, 'GEMINI.md');
        //     await fs.writeFile(geminiFilePath, geminiContent);
        // }


        const exampleFileNames = ['ContactEditViewModel', 'ContactEditFragment'];
        const exampleFilesInfo = files
            .map(file => {
                const baseName = path.basename(file.filePath).split('.')[0];
                if (exampleFileNames.includes(baseName)) {
                    const fileName = path.basename(file.filePath);
                    const absoluteFilePath = path.join(userFilesDir, file.filePath);
                    const relativePath = path.relative(mainFolderPath, absoluteFilePath).replace(/\\/g, '/');
                    if (!relativePath.startsWith('..')) {
                        return `${fileName} @${relativePath}`;
                    }
                }
                return null;
            })
            .filter(Boolean)
            .join(' and ');

        const schemaString = JSON.stringify(schema).replace(/"/g, "'");

        let prompt = `Add logging functionality described by this: ${schemaString} logging the event and metadata. Implement only logging for this for now, stop logic and mark success once you've implemented this logging--DO NOT REVERT/START OVER. Do not add comments or redundancies/artifacts/examples. Do not create new files, instead try to integrate with the existing code (find relevant files). Do not assume dummy data or assume variables for metadata exist--find where information is given and get information from there. If logic appears to be a process/more backend, logic should probably be in logic flows in the repository files. Match the existing logging methods used (may not be default for language). You can look in ${exampleFilesInfo || 'ContactEditViewModel and ContactEditFragment'} for an example of the structure (resources.repository.log.event most likely).`
        
        let cliCommand, cliName, cliArgs;
        if (useClaude) {
            cliName = 'Claude';
            cliCommand = 'claude';
            prompt = `Add logging functionality described by this: ${schemaString} logging the metadata. Don't create new files, but integrate with existing logic. Don't use dummy data for metadata--try to find how to get the metadata in the codebase.`
            cliArgs = ['--dangerously-skip-permissions', `-p "${prompt}"`];
        } else {
            cliName = 'Gemini';
            cliCommand = 'gemini';
            cliArgs = ['--yolo', `-p "${prompt}"`];
        }

        console.log(`Initializing ${cliName} CLI for ${prompt}`);
        let stdoutData = '';
        let stderrData = '';
        const child = spawn(cliCommand, cliArgs, {
            cwd: userFilesDir,
            stdio: ['ignore','pipe','pipe'],
            shell: true,
            env: process.env,
        });

        child.stdout.on('data', chunk => {
            const str = chunk.toString();
            stdoutData += str;
            console.log('[GEMINI stdout]', str);
        });

        child.stderr.on('data', chunk => {
            const str = chunk.toString();
            stderrData += str;
            console.error('[GEMINI stderr]', str);
        });

        child.on('error', err => {
            console.error('Failed to start gemini:', err);
            return res.status(500).json({
                message: 'Could not spawn Gemini process',
                error: err.message,
            });
        });

        child.on('close', async code => {
            console.log(`Gemini exited with code ${code}`);

            if (code !== 0) {
                return res.status(500).json({
                    message: 'Gemini process exited with an error',
                    exitCode: code,
                    stdout: stdoutData,
                    stderr: stderrData,
                });
            }

            // Diff logic starts here
            const modifiedFiles = [];
            const getAllFiles = async (dirPath, fileList = []) => {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        await getAllFiles(fullPath, fileList);
                    } else {
                        fileList.push(fullPath);
                    }
                }
                return fileList;
            };

            const allFilePaths = await getAllFiles(userFilesDir);

            for (const filePath of allFilePaths) {
                const relativePath = path.relative(userFilesDir, filePath).replace(/\\/g, '/');
                if (path.basename(relativePath) === 'GEMINI.md') {
                    continue; // Skip GEMINI.md                
                }

                const originalContent = originalFileContents.get(relativePath);
                const newContent = await fs.readFile(filePath, 'utf8');

                if (originalContent !== newContent) {
                    modifiedFiles.push({
                        filePath: relativePath,
                        modifiedContent: newContent,
                    });
                }
            }

            return res.status(200).json({
                message: 'Gemini process finished successfully',
                stdout: stdoutData,
                stderr: stderrData,
                modifiedFiles: modifiedFiles,
            });
        });

    } catch (error) {
        console.error('Error processing cli-inject request:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: `Failed to process request: ${error.message}` });
        }
    }
});



app.post('/cmd', (req, res) => {
    const { command } = req.body;

    if (!command) {
        return res.status(400).send('Command is required');
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    const child = spawn(command, { shell: true, stdio: 'pipe' });

    child.stdout.pipe(res, { end: false });
    child.stderr.pipe(res, { end: false });

    child.on('close', (code) => {
        console.log(`Child process exited with code ${code}`);
        res.end();
    });

    child.on('error', (err) => {
        console.error('Failed to start subprocess.', err);
        res.status(500).send(`Failed to start subprocess: ${err.message}`);
    });
});

const https = require('https');

(async () => {
    const options = {
        key: await fs.readFile('localhost-key.pem'),
        cert: await fs.readFile('localhost.pem')
    };

    https.createServer(options, app).listen(port, () => {
        console.log(`Server listening at https://localhost:${port}`);
        loadLatestBackup();
        // Set up hourly backups
        setInterval(createBackup, 60 * 60 * 1000); // Every hour
    });
})();

let notifiedClientsForRestore = new Map();
let lastRestoreTimestamp = null;

// Endpoint to get the last restore timestamp and manage notifications
app.get('/api/last-restore', (req, res) => {
    const clientIp = req.ip;
    if (lastRestoreTimestamp && !notifiedClientsForRestore.has(clientIp)) {
        notifiedClientsForRestore.set(clientIp, true);
        res.status(200).json({ timestamp: lastRestoreTimestamp });
    } else {
        res.status(200).json({ timestamp: null });
    }
});