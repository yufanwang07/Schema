import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import ReactDiffViewer from 'react-diff-viewer';

const formatKey = (key) => {
    let formattedKey = key;
    if (formattedKey.startsWith('event_')) {
        formattedKey = formattedKey.substring(6); // "event_".length
    }
    formattedKey = formattedKey.replace(/_/g, ' ');
    return formattedKey.charAt(0).toUpperCase() + formattedKey.slice(1);
};

const JsonTable = ({ data, highlightedPaths = [], animatedValues = {}, pathPrefix = '', useClaude }) => {
    if (typeof data !== 'object' || data === null) {
        const currentPath = pathPrefix;
        const displayValue = animatedValues.hasOwnProperty(currentPath) ? animatedValues[currentPath] : String(data);
        return <span className="text-green-400">{displayValue}</span>;
    }

    return (
        <table className="w-full text-left border-collapse">
            <tbody>
                {Object.entries(data).map(([key, value]) => {
                    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
                    const isHighlighted = highlightedPaths.includes(currentPath);
                    return (
                        <tr key={key} className={`border-b border-gray-800 last:border-b-0 transition-all duration-300 ${isHighlighted ? 'bg-yellow-500 bg-opacity-20' : ''}`}>
                            <td className={`py-1 pr-2 ${useClaude ? 'text-orange-500' : 'text-purple-500'} align-top font-medium`} style={{ width: '120px' }}>{formatKey(key)}</td>
                            <td className="py-1">
                                {Array.isArray(value) ? (
                                    <div className="flex flex-col space-y-1">
                                        {value.map((item, index) => (
                                            <div key={index} className="p-2 bg-gray-800 rounded">
                                                <JsonTable data={item} highlightedPaths={highlightedPaths} animatedValues={animatedValues} pathPrefix={`${currentPath}.${index}`} useClaude={useClaude} />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <JsonTable data={value} highlightedPaths={highlightedPaths} animatedValues={animatedValues} pathPrefix={currentPath} useClaude={useClaude} />
                                )}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

const VisualizedSchemaView = ({ data, highlightedPaths, animatedValues, useClaude }) => {
    if (!data) {
        return <span className="text-gray-500 p-3">Schema will appear here...</span>;
    }

    const eventTitle = data.event_name || data.event_label;

    const mainData = { ...data };
    const metadata = mainData.event_metadata;
    delete mainData.event_metadata;

    const mainDataExists = Object.keys(mainData).length > 0 && Object.values(mainData).some(v => v !== null && v !== '');

    return (
        <div className="p-3">
            {eventTitle && (
                <h3 className="text-md font-semibold text-white mb-3">{formatKey(eventTitle)}</h3>
            )}

            {mainDataExists && <JsonTable data={mainData} highlightedPaths={highlightedPaths} animatedValues={animatedValues} useClaude={useClaude} />}

            {metadata && Object.keys(metadata).length > 0 && (
                <div className="mt-6">
                    <h4 className="text-md font-semibold text-white mb-3">Logged Metadata</h4>
                    <JsonTable data={metadata} highlightedPaths={highlightedPaths} animatedValues={animatedValues} pathPrefix="event_metadata" useClaude={useClaude} />
                </div>
            )}
        </div>
    );
};

const Notification = ({ message, type, onDismiss }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (message) {
            setVisible(true);
            const timer = setTimeout(() => {
                handleDismiss();
            }, 2500); // 2.5 seconds
            return () => clearTimeout(timer);
        }
    }, [message]);

    const handleDismiss = () => {
        setVisible(false);
        setTimeout(onDismiss, 1500); // Wait for fade-out animation to complete
    };

    const baseClasses = "fixed top-5 right-5 p-4 rounded-md shadow-lg text-white flex items-center border-l-4 transition-opacity duration-1500 z-50";
    const typeClasses = {
        info: "bg-blue-900 border-blue-500",
        success: "bg-green-900 border-green-500",
        error: "bg-red-900 border-red-500",
    };

    return (
        <div className={`${baseClasses} ${typeClasses[type] || ''} ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <span className="flex-grow">{message}</span>
            <button onClick={handleDismiss} className="ml-4 text-white">&times;</button>
        </div>
    );
};


const getJsonDiffs = (oldObj, newObj, path = '') => {
    let diffs = [];
    const oldKeys = Object.keys(oldObj || {});
    const newKeys = Object.keys(newObj || {});
    const allKeys = new Set([...oldKeys, ...newKeys]);

    for (const key of allKeys) {
        const currentPath = path ? `${path}.${key}` : key;
        const oldValue = oldObj ? oldObj[key] : undefined;
        const newValue = newObj ? newObj[key] : undefined;

        const isOldObject = typeof oldValue === 'object' && oldValue !== null && !Array.isArray(oldValue);
        const isNewObject = typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue);

        if (isOldObject || isNewObject) {
            diffs = diffs.concat(getJsonDiffs(oldValue, newValue, currentPath));
        } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            diffs.push({ path: currentPath, from: oldValue, to: newValue });
        }
    }
    return diffs;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeNewlines = (text) => {
    if (typeof text !== 'string') {
        return '';
    }
    return text.replace(/\r\n|\r/g, '\n');
};

const stableStringify = (obj) => {
    function sortObject(o) {
        if (o === null || typeof o !== 'object') {
            return o;
        }
        if (Array.isArray(o)) {
            return o.map(sortObject).sort((a, b) => {
                const strA = JSON.stringify(a);
                const strB = JSON.stringify(b);
                return strA.localeCompare(strB);
            });
        }
        const sortedObj = {};
        const keys = Object.keys(o).sort();
        for (const key of keys) {
            sortedObj[key] = sortObject(o[key]);
        }
        return sortedObj;
    }
    return JSON.stringify(sortObject(obj));
};

function App() {
    const [chats, setChats] = useState(() => {
        try {
            const savedChats = localStorage.getItem('chats');
            return savedChats ? JSON.parse(savedChats) : [];
        } catch (error) {
            console.error("Failed to load chats from local storage during initialization:", error);
            return [];
        }
    });
    const [currentChat, setCurrentChat] = useState(null);
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [injecting, setInjecting] = useState(false);
    const [displayedLines, setDisplayedLines] = useState([]);
    const [activeMenuChatId, setActiveMenuChatId] = useState(null);
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
    const [isRightClickMenu, setIsRightClickMenu] = useState(false);
    const fileInputRef = useRef(null);
    const batchFileInputRef = useRef(null);
    const [attachedFile, setAttachedFile] = useState(null);
    const [attachedFileContent, setAttachedFileContent] = useState('');
    const [isFileProcessing, setIsFileProcessing] = useState(false);
    const [fileLoadingProgress, setFileLoadingProgress] = useState(0);
    const [localRoute, setLocalRoute] = useState('');
    const [pendingChanges, setPendingChanges] = useState([]);
    const [directoryHandle, setDirectoryHandle] = useState(null);
    const [originalFiles, setOriginalFiles] = useState([]);
    const [showDiffPanel, setShowDiffPanel] = useState(false);
    const [activeDiffTab, setActiveDiffTab] = useState('');
    const [isNovo, setIsNovo] = useState(true); // New state for Novo switch
    const [useCli, setUseCli] = useState(true);
    const [useClaude, setUseClaude] = useState(false);
    const [useCodeAgent, setUseCodeAgent] = useState(false);
    const [notification, setNotification] = useState({ message: '', type: '' });
    const [showCodeAgentDiff, setShowCodeAgentDiff] = useState(false);
    const [isCodeAgentTyping, setIsCodeAgentTyping] = useState(false);
    const [visualizeMode, setVisualizeMode] = useState(false);
    const [serverChats, setServerChats] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalChat, setModalChat] = useState(null);

    const [animatedChatId, setAnimatedChatId] = useState(null);
    const [schemaView, setSchemaView] = useState('split'); // raw, split, visualized
    const [animatedSchema, setAnimatedSchema] = useState(null);
    const [highlightedPaths, setHighlightedPaths] = useState([]);
    const [animatedValues, setAnimatedValues] = useState({});
    const [activeFilters, setActiveFilters] = useState({ event_type: [], event_action: [], status: [] });
    const [selectedGridChats, setSelectedGridChats] = useState([]);
    const [gridVersion, setGridVersion] = useState(0);
    const [isValidating, setIsValidating] = useState(false);
    const [updatedChats, setUpdatedChats] = useState({}); // { [chatId]: 'green' | 'red' }

    const handleGridItemSelect = (chatId) => {
        setSelectedGridChats(prevSelected => {
            if (prevSelected.includes(chatId)) {
                return prevSelected.filter(id => id !== chatId);
            } else {
                return [...prevSelected, chatId];
            }
        });
        setUpdatedChats(prev => {
            const newUpdated = { ...prev };
            delete newUpdated[chatId];
            return newUpdated;
        });
        setGridVersion(prevVersion => prevVersion + 1);
    };

    const [filteredGridChats, setFilteredGridChats] = useState([]);

    useEffect(() => {
        const filtered = chats.filter(chat => {
            const serverChat = serverChats.find(s => s.id === chat.id);
            const isModified = serverChat && stableStringify(chat.filledSchema) !== stableStringify(serverChat.filledSchema);

            const typeMatch = activeFilters.event_type.length === 0 || activeFilters.event_type.includes(chat.filledSchema?.event_type);
            const actionMatch = activeFilters.event_action.length === 0 || activeFilters.event_action.includes(chat.filledSchema?.event_action);
            const statusMatch = activeFilters.status.length === 0 || activeFilters.status.some(status => {
                if (status === 'Implemented') return chat.implemented;
                if (status === 'Modified') {
                    return isModified;
                }
                if (status === 'Unchanged') {
                    return !chat.implemented && !isModified;
                }
                return false;
            });

            return typeMatch && actionMatch && statusMatch;
        });
        setFilteredGridChats(filtered);
    }, [chats, activeFilters, serverChats]);

    const handleGridSelectAll = () => {
        const filteredChatIds = filteredGridChats.map(c => c.id);
        const allFilteredSelected = filteredChatIds.length > 0 && filteredChatIds.every(id => selectedGridChats.includes(id));

        if (allFilteredSelected) {
            // Deselect all filtered chats
            setSelectedGridChats(prevSelected => prevSelected.filter(id => !filteredChatIds.includes(id)));
        } else {
            // Select all filtered chats, keeping existing selections from other filters
            setSelectedGridChats(prevSelected => [...new Set([...prevSelected, ...filteredChatIds])]);
        }
        setGridVersion(prevVersion => prevVersion + 1);
    };

    const allEventTypes = [...new Set(chats.map(chat => chat.filledSchema?.event_type).filter(Boolean))];
    const allEventActions = [...new Set(chats.map(chat => chat.filledSchema?.event_action).filter(Boolean))];

    const gridItemRefs = useRef({});


    const schemaDisplayRef = useRef(null);
    const prevFilledSchema = useRef(null);
    const animationIdRef = useRef(0);
    const isMounted = useRef(false);
    const chatContainerRef = useRef(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [currentChat?.messages]);

    const filteredChats = chats.filter(chat =>
        chat.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Load chats from local storage on initial render
    useEffect(() => {
        const fetchServerChats = async () => {
            try {
                const serverResponse = await fetch('/api/schemas');
                if (!serverResponse.ok) {
                    throw new Error(`Failed to fetch schemas from server: ${serverResponse.statusText}`);
                }
                const serverSchemas = await serverResponse.json();
                setServerChats(serverSchemas);
            } catch (error) {
                console.error('Error fetching server schemas:', error);
            }
        };

        fetchServerChats();

        const checkServerRestore = async () => {
            try {
                const response = await fetch('/api/last-restore');
                if (response.ok) {
                    const data = await response.json();
                    if (data.timestamp) {
                        setNotification({ message: `Server has been restored to a backup from: ${new Date(data.timestamp).toLocaleString()}`, type: 'info' });
                    }
                }
            } catch (error) {
                console.error("Error checking server restore status:", error);
            }
        };

        checkServerRestore();

        try {
            const savedChats = localStorage.getItem('chats');
            if (savedChats) {
                let parsedChats = JSON.parse(savedChats);
                if (parsedChats.length > 0) {
                    const firstChat = { ...parsedChats[0], isNew: false };
                    parsedChats[0] = firstChat;
                    setChats(parsedChats);
                    setCurrentChat(firstChat);
                    const initialSchema = firstChat.filledSchema ? JSON.stringify(firstChat.filledSchema, null, 2) : '';
                    setDisplayedLines(initialSchema.split('\n').map(text => ({ text, highlight: false })));
                    // Do NOT set prevFilledSchema.current here. It will be handled by the animation useEffect;
                } else {
                    setChats(parsedChats);
                }
            }
        } catch (error) {
            console.error("Failed to load chats from local storage during initialization:", error);
        }
    }, []);

    // Save chats to local storage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('chats', JSON.stringify(chats));
        } catch (error) {
            console.error("Failed to save chats to local storage:", error);
        }
    }, [chats]);

    useEffect(() => {
        if (notification.message) {
            const timer = setTimeout(() => {
                setNotification({ message: '', type: '' });
            }, 5000); // 5 seconds
            return () => clearTimeout(timer);
        }
    }, [notification]);

    // Effect for line-by-line animation of the schema
    useEffect(() => {
        const newSchema = currentChat?.filledSchema; ""
        const newSchemaString = newSchema ? JSON.stringify(newSchema, null, 2) : '';

        // If the chat ID has changed, we skip the animation entirely.
        if (currentChat?.id !== animatedChatId) {
            setAnimatedSchema(newSchema);
            setDisplayedLines(newSchemaString.split('\n').map(text => ({ text, highlight: false })));
            prevFilledSchema.current = newSchemaString;
            setAnimatedChatId(currentChat?.id);
            return; // Exit early
        }

        // --- Raw Animation Logic ---
        if (newSchemaString !== prevFilledSchema.current) {
            const animationId = ++animationIdRef.current;
            const animateRaw = async () => {
                const oldLines = (prevFilledSchema.current || '').split('\n');
                const newLines = newSchemaString.split('\n');
                const maxLines = Math.max(oldLines.length, newLines.length);
                let currentDisplay = oldLines.map(text => ({ text, highlight: false }));

                for (let i = 0; i < maxLines; i++) {
                    if (animationId !== animationIdRef.current) return;
                    const oldLine = oldLines[i] || '';
                    const newLine = newLines[i] || '';

                    if (oldLine !== newLine) {
                        let commonPrefix = 0;
                        while (commonPrefix < oldLine.length && commonPrefix < newLine.length && oldLine[commonPrefix] === newLine[commonPrefix]) {
                            commonPrefix++;
                        }
                        let commonSuffix = 0;
                        while (commonSuffix < oldLine.length - commonPrefix && commonSuffix < newLine.length - commonPrefix && oldLine[oldLine.length - 1 - commonSuffix] === newLine[newLine.length - 1 - commonSuffix]) {
                            commonSuffix++;
                        }
                        const oldTextMiddle = oldLine.substring(commonPrefix, oldLine.length - commonSuffix);
                        const newTextMiddle = newLine.substring(commonPrefix, newLine.length - commonSuffix);

                        for (let j = oldTextMiddle.length; j >= 0; j--) {
                            if (animationId !== animationIdRef.current) return;
                            const text = oldLine.substring(0, commonPrefix) + oldTextMiddle.substring(0, j) + oldLine.substring(oldLine.length - commonSuffix);
                            if (i < currentDisplay.length) currentDisplay[i] = { text, highlight: true };
                            else currentDisplay.push({ text, highlight: true });
                            setDisplayedLines([...currentDisplay]);
                            await sleep(10);
                        }
                        for (let j = 1; j <= newTextMiddle.length; j++) {
                            if (animationId !== animationIdRef.current) return;
                            const text = oldLine.substring(0, commonPrefix) + newTextMiddle.substring(0, j) + oldLine.substring(oldLine.length - commonSuffix);
                            if (i < currentDisplay.length) currentDisplay[i] = { text, highlight: true };
                            else currentDisplay.push({ text, highlight: true });
                            setDisplayedLines([...currentDisplay]);
                            await sleep(10);
                        }
                        if (i < currentDisplay.length) {
                            currentDisplay[i].text = newLine;
                            currentDisplay[i].highlight = false;
                            setDisplayedLines([...currentDisplay]);
                        }
                    } else {
                        if (i < currentDisplay.length) currentDisplay[i].highlight = false;
                        setDisplayedLines([...currentDisplay]);
                    }
                }
                if (newLines.length < oldLines.length) {
                    currentDisplay.splice(newLines.length);
                    setDisplayedLines([...currentDisplay]);
                }
                prevFilledSchema.current = newSchemaString;
            };
            animateRaw();
        }

        // --- Visualized Animation Logic ---
        if (newSchema && JSON.stringify(newSchema) !== JSON.stringify(animatedSchema)) {
            const diffs = getJsonDiffs(animatedSchema || {}, newSchema);
            if (diffs.length > 0) {
                let tempSchema = JSON.parse(JSON.stringify(animatedSchema || {}));
                const animateVisualized = async () => {
                    for (const diff of diffs) {
                        setHighlightedPaths(prev => [...prev, diff.path]);
                        await sleep(200); // Flash highlight

                        const fromString = String(diff.from || '');
                        const toString = String(diff.to || '');

                        for (let i = fromString.length; i >= 0; i--) {
                            setAnimatedValues(prev => ({ ...prev, [diff.path]: fromString.substring(0, i) }));
                            await sleep(10);
                        }
                        for (let i = 1; i <= toString.length; i++) {
                            setAnimatedValues(prev => ({ ...prev, [diff.path]: toString.substring(0, i) }));
                            await sleep(10);
                        }

                        const pathParts = diff.path.split('.');
                        let current = tempSchema;
                        for (let i = 0; i < pathParts.length - 1; i++) {
                            current = current[pathParts[i]] = current[pathParts[i]] || {};
                        }
                        current[pathParts[pathParts.length - 1]] = diff.to;
                        setAnimatedSchema(JSON.parse(JSON.stringify(tempSchema)));
                        setAnimatedValues(prev => {
                            const newValues = { ...prev };
                            delete newValues[diff.path];
                            return newValues;
                        });
                        await sleep(100);
                        setHighlightedPaths(prev => prev.filter(p => p !== diff.path));
                    }
                    setAnimatedSchema(newSchema);
                };
                animateVisualized();
            } else {
                setAnimatedSchema(newSchema);
            }
        } else if (!newSchema) {
            setAnimatedSchema(null);
        }
    }, [currentChat?.filledSchema]);


    const handleNewChat = async () => {
        setLoading(true);
        try {
            const response = await fetch('/schema.json');
            const schemaData = await response.json();
            const newChat = {
                id: Date.now(),
                name: `New Event`,
                messages: [],
                schema: JSON.stringify(schemaData, null, 2),
                filledSchema: null,
                isNew: false,
                implemented: false
            };
            setChats(prevChats => [...prevChats, newChat]);
            setCurrentChat(newChat);
            setDisplayedLines([]);
            prevFilledSchema.current = '';
        } catch (error) {
            console.error('Error fetching initial schema:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectChat = (chat) => {
        setCurrentChat(chat);
        const selectedSchemaString = chat.filledSchema ? JSON.stringify(chat.filledSchema, null, 2) : '';
        // No animation on select, just show the final state        
        setDisplayedLines(selectedSchemaString.split('\n').map(text => ({ text, highlight: false }))); 
        prevFilledSchema.current = selectedSchemaString; 
        setChats(prevChats => prevChats.map(c => c.id === chat.id ? { ...c, isNew: false } : c));
    }; 
    const handleSelectChatAndExitVisualize = (chat) => { handleSelectChat(chat); if (visualizeMode) { setVisualizeMode(false); } };

    const handleDeleteChat = (idToDelete) => {
        setChats(prevChats => {
            const updatedChats = prevChats.filter(chat => chat.id !== idToDelete);
            if (currentChat && currentChat.id === idToDelete) {
                setCurrentChat(null);
                setDisplayedLines([]);
                prevFilledSchema.current = '';
            } else if (updatedChats.length > 0 && !currentChat) {
                const firstChat = updatedChats[0];
                setCurrentChat(firstChat);
                const initialSchema = firstChat.filledSchema ? JSON.stringify(firstChat.filledSchema, null, 2) : '';
                setDisplayedLines(initialSchema.split('\n').map(text => ({ text, highlight: false })));
                prevFilledSchema.current = initialSchema;
            }
            return updatedChats;
        });
    };

    const handleSyncChatToServer = async (chatId) => {
        const chatToSync = chats.find(chat => chat.id === chatId);
        if (!chatToSync || !chatToSync.filledSchema) {
            setNotification({ message: 'This event has no data to sync.', type: 'info' });
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: chatToSync.id,
                    name: chatToSync.name,
                    filledSchema: chatToSync.filledSchema,
                    implemented: chatToSync.implemented
                }),
            });
            if (!response.ok) {
                throw new Error(`Failed to sync schema ${chatToSync.name} to server: ${response.statusText}`);
            }
            setNotification({ message: `'${chatToSync.name}' synced with server!`, type: 'success' });

            // Manually update the serverChats state to reflect the sync
            setServerChats(prevServerChats => {
                const existingServerChatIndex = prevServerChats.findIndex(c => c.id === chatId);
                const newServerChat = {
                    id: chatToSync.id,
                    name: chatToSync.name,
                    filledSchema: chatToSync.filledSchema,
                    implemented: chatToSync.implemented
                };
                if (existingServerChatIndex > -1) {
                    const updatedServerChats = [...prevServerChats];
                    updatedServerChats[existingServerChatIndex] = newServerChat;
                    return updatedServerChats;
                } else {
                    return [...prevServerChats, newServerChat];
                }
            });

        } catch (error) {
            console.error('Error syncing schema to server:', error);
            setNotification({ message: 'Failed to sync schema. Check console for details.', type: 'error' });
        } finally {
            setLoading(false);
            setActiveMenuChatId(null);
        }
    };

    const handleDeleteChatFromServer = async (chatId) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/schemas/${chatId}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                throw new Error(`Failed to delete schema from server: ${response.statusText}`);
            }
            handleDeleteChat(chatId);
            setNotification({ message: 'Schema deleted from server and locally.', type: 'success' });
        } catch (error) {
            console.error('Error deleting schema from server:', error);
            setNotification({ message: 'Failed to delete schema from server. Check console for details.', type: 'error' });
        } finally {
            setLoading(false);
            setActiveMenuChatId(null);
        }
    };


    const handleReloadFromServer = async () => {
        setLoading(true);
        try {
            const serverResponse = await fetch('/api/schemas');
            if (!serverResponse.ok) {
                throw new Error(`Failed to fetch schemas from server: ${serverResponse.statusText}`);
            }
            const serverSchemas = await serverResponse.json();
            setServerChats(serverSchemas);

            const baseSchemaResponse = await fetch('/schema.json');
            if (!baseSchemaResponse.ok) {
                throw new Error(`Failed to fetch base schema: ${baseSchemaResponse.statusText}`);
            }
            const baseSchemaData = await baseSchemaResponse.json();
            const baseSchemaString = JSON.stringify(baseSchemaData, null, 2);

            setChats(prevChats => {
                let updatedChats = [...prevChats];
                serverSchemas.forEach(serverSchema => {
                    const existingChatIndex = updatedChats.findIndex(chat => chat.id === serverSchema.id);
                    const chatData = {
                        name: serverSchema.name,
                        filledSchema: serverSchema.filledSchema,
                        schema: baseSchemaString, // Always provide the base schema
                        isNew: true,
                        implemented: serverSchema.implemented
                    };

                    if (existingChatIndex > -1) {
                        updatedChats[existingChatIndex] = {
                            ...updatedChats[existingChatIndex],
                            ...chatData
                        };
                    } else {
                        updatedChats.push({
                            id: serverSchema.id,
                            messages: [],
                            ...chatData
                        });
                    }
                });
                return updatedChats;
            });

        } catch (error) {
            console.error('Error reloading schemas from server:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAllLocalEvents = () => {
        setChats([]);
        setCurrentChat(null);
        setDisplayedLines([]);
        prevFilledSchema.current = '';
        localStorage.removeItem('chats');
    };

    const handleSyncAllToServer = async () => {
        setLoading(true);
        try {
            for (const chat of chats) {
                if (chat.filledSchema) {
                    const response = await fetch('/api/schemas', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: chat.id,
                            name: chat.name,
                            filledSchema: chat.filledSchema,
                            implemented: chat.implemented
                        }),
                    });
                    if (!response.ok) {
                        throw new Error(`Failed to sync schema ${chat.name} to server: ${response.statusText}`);
                    }
                }
            }
            setNotification({ message: 'All local schemas synced with server!', type: 'success' });
        } catch (error) {
            console.error('Error syncing schemas to server:', error);
            setNotification({ message: 'Failed to sync all schemas with server. Check console for details.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleClearServerMemory = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/schemas', {
                method: 'DELETE',
            });
            if (!response.ok) {
                throw new Error(`Failed to clear server memory: ${response.statusText}`);
            }
            setNotification({ message: 'Server memory cleared successfully!', type: 'success' });
        } catch (error) {
            console.error('Error clearing server memory:', error);
            setNotification({ message: 'Failed to clear server memory. Check console for details.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadAllSchemas = async () => {
        if (chats.length === 0) {
            setNotification({ message: "No schemas to download.", type: 'info' });
            return;
        }

        setLoading(true);
        try {
            const zip = new JSZip();
            chats.forEach(chat => {
                if (chat.filledSchema) {
                    const fileName = `${chat.name.replace(/[^a-zA-Z0-9]/g, '_')}_${chat.id}.json`;
                    zip.file(fileName, JSON.stringify(chat.filledSchema, null, 2));
                }
            });

            if (Object.keys(zip.files).length === 0) {
                setNotification({ message: "No filled schemas to download.", type: 'info' });
                return;
            }

            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, "all_schemas.zip");
            setNotification({ message: "All filled schemas downloaded as a zip file!", type: 'success' });
        } catch (error) {
            console.error('Error downloading schemas:', error);
            setNotification({ message: 'Failed to download schemas. Check console for details.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleBackupServer = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/backup-server', {
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(`Failed to backup server: ${response.statusText}`);
            }
            setNotification({ message: 'Server data backed up successfully!', type: 'success' });
        } catch (error) {
            console.error('Error backing up server:', error);
            setNotification({ message: 'Failed to backup server. Check console for details.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateReport = async () => {
        if (!directoryHandle) {
            setNotification({ message: "Please select a folder to generate the report.", type: 'info' });
            return;
        }

        const schemasToValidate = chats.filter(chat => selectedGridChats.includes(chat.id) && !chat.implemented);

        if (schemasToValidate.length === 0) {
            setNotification({ message: "No selected, unimplemented schemas to validate.", type: 'info' });
            return;
        }

        setIsValidating(true);
        try {
            const filesToProcess = await readAllFilesFromDirectoryHandle(directoryHandle, '', useCli);
            const trimmedFiles = filesToProcess.map(file => {
                if (file.content) {
                    return { ...file, content: String(file.content).trim() };
                }
                return file;
            });

            for (const schema of schemasToValidate) {
                const response = await fetch('/api/validate-implementation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        schema: schema.filledSchema,
                        files: trimmedFiles,
                        useClaude: useClaude,
                        useCli: useCli
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Failed to validate schema: ${schema.name}`);
                }

                const result = await response.json();
                
                setSelectedGridChats(prev => prev.filter(id => id !== schema.id));

                if (result.implemented) {
                    setChats(prevChats => prevChats.map(chat => chat.id === schema.id ? { ...chat, implemented: true } : chat));
                    setUpdatedChats(prev => ({ ...prev, [schema.id]: 'green' }));
                } else {
                    setUpdatedChats(prev => ({ ...prev, [schema.id]: 'red' }));
                }
            }

            setNotification({ message: 'Validation complete.', type: 'success' });
        } catch (error) {
            console.error('Error generating report:', error);
            setNotification({ message: `Failed to generate report: ${error.message}`, type: 'error' });
        } finally {
            setIsValidating(false);
        }
    };

    const handlePromptChange = (event) => {
        setPrompt(event.target.value);
    };

    const handleAttachFile = () => {
        fileInputRef.current.click();
    };

    const MAX_FILE_SIZE_FOR_FULL_DURATION = 1024 * 1024; // 1MB
    const MAX_LOADING_DURATION_MS = 4000; // 4 seconds

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            setAttachedFile(file);
            setIsFileProcessing(true);
            setFileLoadingProgress(0);

            const reader = new FileReader();
            reader.onload = async (e) => {
                setAttachedFileContent(e.target.result);

                const totalSimulationDuration = Math.min(
                    (file.size / MAX_FILE_SIZE_FOR_FULL_DURATION) * MAX_LOADING_DURATION_MS,
                    MAX_LOADING_DURATION_MS
                );

                const numSteps = 15; // Number of "jumps"
                const baseSleepTime = totalSimulationDuration / numSteps;

                for (let i = 0; i < numSteps; i++) {
                    // Calculate progress for this step
                    const startProgress = (i / numSteps) * 100;
                    const endProgress = ((i + 1) / numSteps) * 100;
                    const currentProgress = Math.floor(startProgress + Math.random() * (endProgress - startProgress));

                    setFileLoadingProgress(currentProgress);

                    // Randomize sleep time around the baseSleepTime
                    const randomSleepOffset = (Math.random() - 0.5) * baseSleepTime * 0.8; // +/- 40% of baseSleepTime
                    const sleepDuration = Math.max(50, baseSleepTime + randomSleepOffset); // Ensure minimum sleep

                    await sleep(sleepDuration);
                }
                setFileLoadingProgress(100); // Ensure it ends at 100%

                setIsFileProcessing(false);
            };
            reader.readAsText(file);
        } else {
            setAttachedFile(null);
            setAttachedFileContent('');
            setIsFileProcessing(false);
            setFileLoadingProgress(0);
        }
    };

    const handleRemoveAttachedFile = () => {
        setAttachedFile(null);
        setAttachedFileContent('');
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // Clear the file input
        }
    };

    const handleBatchUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target.result;
            setLoading(true);
            try {
                const response = await fetch('/api/batch-schemas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content }),
                });

                if (!response.ok) {
                    throw new Error('Failed to batch create schemas');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep the last partial line in the buffer

                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        const newChat = JSON.parse(line);
                        setChats(prevChats => [...prevChats, newChat]);
                    }
                }

            } catch (error) {
                console.error('Error during batch creation:', error);
                alert('Failed to batch create schemas. See console for details.');
            } finally {
                setLoading(false);
            }
        };
        reader.readAsText(file);
    };

    const handleSubmit = async () => {
        if (!prompt.trim()) return;

        let chatToUse = currentChat;

        // If no active chat, create one.
        if (!chatToUse) {
            setLoading(true);
            try {
                const response = await fetch('/schema.json');
                const schemaData = await response.json();
                const newChat = {
                    id: Date.now(),
                    name: `New Event`,
                    messages: [],
                    schema: JSON.stringify(schemaData, null, 2),
                    filledSchema: null,
                    isNew: false
                };
                // Set the new chat as active immediately.
                setChats(prevChats => [...prevChats, newChat]);
                setCurrentChat(newChat);
                setDisplayedLines([]);
                prevFilledSchema.current = '';
                chatToUse = newChat; // Ensure chatToUse is the new chat for the rest of this function.
            } catch (error) {
                console.error('Error fetching initial schema:', error);
                setLoading(false);
                return;
            } finally {
                setLoading(false);
            }
        }

        setLoading(true);
        const userMessage = { role: 'user', content: prompt };
        const updatedMessages = [...chatToUse.messages, userMessage];
        const conversationHistory = updatedMessages.slice(-10);

        // Update the current chat with the new user message to give immediate feedback.
        // Use chatToUse to avoid issues with stale state.
        const updatedChatWithUserMessage = { ...chatToUse, messages: updatedMessages };
        setCurrentChat(updatedChatWithUserMessage);
        setChats(prevChats => prevChats.map(c => c.id === chatToUse.id ? updatedChatWithUserMessage : c));


        const schemaToSend = chatToUse.filledSchema
            ? JSON.stringify(chatToUse.filledSchema, null, 2)
            : "Here's the structure. Fill out according to this structure. Make sure you don't include this in the output:\n" + chatToUse.schema;

        let fullPrompt = prompt;
        if (attachedFileContent) {
            fullPrompt = `User message: ${prompt}\n\nAttached file content:\n${attachedFileContent}`;
        }

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    schema: schemaToSend,
                    prompt: fullPrompt,
                    conversationHistory,
                    useCodeAgent
                }),
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const data = await response.json();
            let finalMessages = updatedMessages;
            // Use chatToUse to ensure we're updating the correct chat object.
            let updatedChat = { ...chatToUse, messages: updatedMessages };

            if (data.action === 'update_schema') {
                const { schema, explanation } = data.payload;
                const assistantMessage = { role: 'assistant', content: explanation };
                finalMessages = [...updatedMessages, assistantMessage];

                let eventName = chatToUse.name;
                if (schema && (schema.event_label || schema.event_name)) {
                    const rawEventName = schema.event_label || schema.event_name;
                    eventName = rawEventName
                        .split('_')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                }
                updatedChat = { ...chatToUse, name: eventName, messages: finalMessages, filledSchema: schema || null, implemented: false };

            } else if (data.action === 'answer_question') {
                const { answer } = data.payload;
                const assistantMessage = { role: 'assistant', content: answer };
                finalMessages = [...updatedMessages, assistantMessage];
                updatedChat = { ...chatToUse, messages: finalMessages, filledSchema: chatToUse.filledSchema || null };
            } else if (data.action === 'code_agent') {
                const { prompt: codeAgentPrompt, explanation } = data.payload;
                const assistantMessage = { role: 'assistant', content: explanation };
                finalMessages = [...updatedMessages, assistantMessage];
                updatedChat = { ...chatToUse, messages: finalMessages };
                setChats(prevChats => prevChats.map(chat => chat.id === updatedChat.id ? updatedChat : chat));
                setCurrentChat(updatedChat);

                await handleCodeAgent(codeAgentPrompt);
            }

            if (data.action !== 'code_agent') {
                setChats(prevChats => prevChats.map(chat => chat.id === updatedChat.id ? updatedChat : chat));
                setCurrentChat(updatedChat);
                setPrompt('');
            }

        } catch (error) {
            console.error('Error generating response:', error);
            const errorMessage = { role: 'assistant', content: `Sorry, I encountered an error: ${error.message}` };
            const finalMessages = [...updatedMessages, errorMessage];
            const updatedChatWithError = { ...chatToUse, messages: finalMessages };
            setChats(prevChats => prevChats.map(chat => chat.id === updatedChatWithError.id ? updatedChatWithError : chat));
            setCurrentChat(updatedChatWithError);
        } finally {
            setLoading(false);
        }
    };

    const handleCodeAgent = async (prompt) => {
        if ((!localRoute.trim() && !directoryHandle)) {
            setNotification({ message: "Please select a folder to run the code agent.", type: 'info' })

            return;
        }
        setInjecting(true);
        setIsCodeAgentTyping(true);
        try {
            let filesToProcess = []

            let baseDirPath = ''
            if (directoryHandle) {
                baseDirPath = directoryHandle.name

                filesToProcess = await readAllFilesFromDirectoryHandle(directoryHandle, '', useCli)

            } else if (localRoute.trim()) {
                setNotification({ message: "Code agent currently only works with a selected folder.", type: 'info' })

                setInjecting(false)
                setIsCodeAgentTyping(false)
                return
            }
            const trimmedFiles = filesToProcess.map(file => {
                if (file.content) {
                    return { ...file, content: String(file.content).trim() }
                } return file
            })

            setOriginalFiles(filesToProcess)
            const endpoint = '/api/code-agent'
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt, files: trimmedFiles, baseDirPath: baseDirPath, useClaude: useClaude, useCli: useCli }), })

            if (!response.ok) {
                const errorData = await response.text()

                throw new Error(`Failed to run code agent: ${response.statusText}. ${errorData}`)

            } const reader = response.body.getReader()

            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()

                if (done) {
                    break
                } buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop(); // Keep the last partial line in the buffer                
                for (const line of lines) {
                    if (line.trim() === '') continue
                    const data = JSON.parse(line)
                    if (data.stdout) {
                        const newMessages = [{ role: 'assistant', content: `${data.stdout}` }]
                        setChats(prevChats => prevChats.map(chat => {
                            if (chat.id === currentChat.id) {
                                const updatedMessages = [...chat.messages, ...newMessages]
                                setCurrentChat({ ...chat, messages: updatedMessages })
                                return { ...chat, messages: updatedMessages }
                            } return chat
                        }))
                    } if (data.modifiedFiles) {
                        setPendingChanges(data.modifiedFiles)
                        setActiveDiffTab(data.modifiedFiles[0].filePath)
                        setShowCodeAgentDiff(true)
                        setShowDiffPanel(false)
                    }
                }
            }
        } catch (error) {
            console.error('Error running code agent:', error)
            setNotification({ message: `Failed to run code agent: ${error.message}`, type: 'error' })
            const errorMessage = { role: 'assistant', content: `Sorry, I encountered an error with the code agent: ${error.message}` }
            setChats(prevChats => prevChats.map(chat => {
                if (chat.id === currentChat.id) {
                    const updatedMessages = [...chat.messages, errorMessage]
                    setCurrentChat({ ...chat, messages: updatedMessages })
                    return { ...chat, messages: updatedMessages }
                } return chat
            }));
        } finally {
            setInjecting(false)
            setIsCodeAgentTyping(false)
            setPrompt('');
        }
    };

    const handleApproveChanges = async () => {
        if (!directoryHandle || pendingChanges.length === 0) {
            setNotification({ message: "No pending changes or folder not selected.", type: 'info' });
            return;
        }

        setLoading(true);
        try {
            for (const modifiedFile of pendingChanges) {
                await writeFileToDirectoryHandle(directoryHandle, modifiedFile.filePath, modifiedFile.modifiedContent);
            }
            setNotification({ message: "Changes approved and applied to local files!", type: 'success' });
            setChats(prevChats => prevChats.map(chat => chat.id === currentChat.id ? { ...chat, implemented: true } : chat));
            setPendingChanges([]);
            setOriginalFiles([]);
            setShowDiffPanel(false);
            setShowCodeAgentDiff(false);
            setActiveDiffTab('');
        } catch (error) {
            console.error('Error applying changes:', error);
            setNotification({ message: `Failed to apply changes: ${error.message}`, type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleInjectLogging = async () => {
        if (!currentChat || !currentChat.filledSchema || (!localRoute.trim() && !directoryHandle)) {
            setNotification({ message: "Please select a schema and provide a local route or select a folder.", type: 'info' });
            return;
        }

        setInjecting(true);
        try {
            let filesToProcess = [];
            let baseDirPath = '';

            if (directoryHandle) {
                baseDirPath = directoryHandle.name;
                filesToProcess = await readAllFilesFromDirectoryHandle(directoryHandle, '', useCli);
            } else if (localRoute.trim()) {
                filesToProcess = [{ filePath: localRoute, content: null }];
            }

            const trimmedFiles = filesToProcess.map(file => {
                if (file.content) {
                    return { ...file, content: String(file.content).trim() };
                }
                return file;
            });

            setOriginalFiles(filesToProcess);
            console.log(trimmedFiles.length)

            const endpoint = useCli ? '/api/cli-inject' : (isNovo ? '/api/inject-novo' : '/api/inject-logging');
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    schema: currentChat.filledSchema,
                    files: trimmedFiles,
                    baseDirPath: baseDirPath,
                    useClaude: useClaude
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to inject logging: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.modifiedFiles && data.modifiedFiles.length > 0) {
                setPendingChanges(data.modifiedFiles);
                setActiveDiffTab(data.modifiedFiles[0].filePath);
                setShowDiffPanel(true);
                setNotification({ message: 'Logging functionality processed. Review changes and click "Approve Changes" to apply.', type: 'success' });
            } else {
                setNotification({ message: data.message || 'No changes were suggested by the AI.', type: 'info' });
            }

        } catch (error) {
            console.error('Error injecting logging:', error);
            setNotification({ message: `Failed to inject logging: ${error.message}`, type: 'error' });
        } finally {
            setInjecting(false);
        }
    };

    const handleSelectFolder = async () => {
        try {
            if (!('showDirectoryPicker' in window)) {
                setNotification({ message: "Your browser does not support the File System Access API. Please use a modern browser like Chrome, Edge, or Opera.", type: 'error' });
                return;
            }
            // if (!window.isSecureContext) {
            //     setNotification({ message: "The File System Access API requires a secure context (HTTPS). Please access this application over HTTPS.", type: 'error' });
            //     return;
            // }

            const handle = await window.showDirectoryPicker();
            setDirectoryHandle(handle);
            setLocalRoute(handle.name); // Display the folder name in the input
        } catch (error) {
            console.error('Error selecting folder:', error);
            if (error.name === 'AbortError') {
                console.log('User cancelled folder selection.');
            } else {
                setNotification({ message: `Failed to select folder: ${error.message}`, type: 'error' });
            }
        }
    };

    // Helper function to recursively read files from a DirectoryHandle
    const readAllFilesFromDirectoryHandle = async (directoryHandle, relativePath = '', useCli = false) => {
        const files = [];
        const IGNORE_DIRS_COMMON = ['__pycache__', 'node_modules', '.git', '.env', 'img', 'build', 'dist', 'out', 'temp', 'backups', 'assets', 'res', 'example', 'data', 'sync', 'util', '.gradle', '.idea'];
        const IGNORE_DIRS_NOVO = ['__pycache__', 'node_modules', '.git', '.env', 'img', 'build', 'dist', 'out', 'temp', 'backups', 'assets', 'example', '.gradle', '.idea', 'test', 'core', 'fastlane', 'gradle', 'Jenkins', 'raw']; // Add Novo specific ignored directories here
        const IGNORE_DIRS = isNovo ? IGNORE_DIRS_NOVO : IGNORE_DIRS_COMMON;
        const IGNORE_EXTENSIONS = ['.apk', '.lock', '.ttf', '.properties', '.gradle', '.json', '.env', '.git', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.gitignore', '.ico', '.mp3', '.wav', '.mp4', '.mov', '.avi', '.wmv', '.pdf', '.doc', '.docx', '.ppt', '.pptx'];

        for await (const entry of directoryHandle.values()) {
            const entryPath = `${relativePath}/${entry.name}`;
            if (entry.kind === 'file') {
                if (IGNORE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
                    continue;
                }
                try {
                    const file = await entry.getFile();
                    const content = await file.text();
                    files.push({ filePath: entryPath.substring(1), content: content }); // Remove leading slash
                } catch (e) {
                    console.warn(`Could not read file ${entryPath}: ${e.message}`);
                }
            } else if (entry.kind === 'directory') {
                if (!IGNORE_DIRS.includes(entry.name)) {
                    files.push(...await readAllFilesFromDirectoryHandle(entry, entryPath, useCli));
                }
            }
        }

        // Sort files by content length in descending order
        const sortedFiles = files.slice().sort((a, b) => b.content.length - a.content.length);

        // Log the top 10 largest files
        console.log("Top 10 largest files:");
        sortedFiles.slice(0, 10).forEach(file => {
            console.log(`${file.filePath}: ${file.content.length} characters`);
        });

        return files;
    };

    // Helper function to write files back to a DirectoryHandle
    const writeFileToDirectoryHandle = async (directoryHandle, relativePath, content) => {
        const pathParts = relativePath.split('/');
        let currentHandle = directoryHandle;

        // Traverse or create directories
        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
        }

        const fileName = pathParts[pathParts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    };

    const handleSelectChatFromGrid = (chat) => {
        setModalChat(chat);
        setIsModalOpen(true);
    };

    const handleOverrideImplementation = async (chatId) => {
        setChats(prevChats => prevChats.map(chat => chat.id === chatId ? { ...chat, implemented: true } : chat));
        try {
            await fetch(`/api/schemas/${chatId}/implemented`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ implemented: true }),
            });
        } catch (error) {
            console.error('Error syncing implementation status:', error);
        }
    };

    const handleUnimplement = async (chatId) => {
        setChats(prevChats => prevChats.map(chat => chat.id === chatId ? { ...chat, implemented: false } : chat));
        try {
            await fetch(`/api/schemas/${chatId}/implemented`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ implemented: false }),
            });
        } catch (error) {
            console.error('Error syncing implementation status:', error);
        }
    };

    const FilterControls = ({ types, actions, activeFilters, setActiveFilters, onSelectAll, numSelected, numTotal }) => {
        const handleFilterChange = (filterType, value) => {
            setActiveFilters(prev => {
                const currentFilters = prev[filterType];
                if (currentFilters.includes(value)) {
                    return { ...prev, [filterType]: currentFilters.filter(v => v !== value) };
                } else {
                    return { ...prev, [filterType]: [...currentFilters, value] };
                }
            });
        };

        return (
            <div className="p-4 bg-gray-900 border-b border-gray-800">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-gray-300">Filters</h3>
                    <button
                        className="inline-flex items-center text-xs font-medium text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
                        onClick={onSelectAll}
                    >
                        {numSelected >= numTotal && numTotal > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                </div>
                <div className="mb-2">
                    <h3 className="text-sm font-semibold text-gray-300 mb-1">Event Type</h3>
                    <div className="flex flex-wrap gap-2">
                        {types.map(type => (
                            <button
                                key={type}
                                onClick={() => handleFilterChange('event_type', type)}
                                className={`px-2 py-1 text-xs rounded-full transition-colors duration-200 ${activeFilters.event_type.includes(type) ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                                {type}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mb-2">
                    <h3 className="text-sm font-semibold text-gray-300 mb-1">Event Action</h3>
                    <div className="flex flex-wrap gap-2">
                        {actions.map(action => (
                            <button
                                key={action}
                                onClick={() => handleFilterChange('event_action', action)}
                                className={`px-2 py-1 text-xs rounded-full transition-colors duration-200 ${activeFilters.event_action.includes(action) ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                                {action}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-1">Status</h3>
                    <div className="flex flex-wrap gap-2">
                        {['Implemented', 'Modified', 'Unchanged'].map(status => {
                            const isActive = activeFilters.status.includes(status);
                            let colorClass = 'bg-gray-700 text-gray-300 hover:bg-gray-600';
                            if (isActive) {
                                if (status === 'Implemented') colorClass = 'bg-green-600 text-white';
                                else if (status === 'Modified') colorClass = 'bg-blue-600 text-white';
                                else if (status === 'Unchanged') colorClass = 'bg-white text-black';
                            }
                            return (
                                <button
                                    key={status}
                                    onClick={() => handleFilterChange('status', status)}
                                    className={`px-2 py-1 text-xs rounded-full transition-colors duration-200 ${colorClass}`}>
                                    {status}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const EventGrid = ({ chats, onSelectChat, serverChats, onOverride, onUnimplement, onSync, onDelete, activeFilters, selectedChats, onSelect }) => {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4 content-start">
                {chats.map(chat => {
                    const serverChat = serverChats.find(s => s.id === chat.id);
                    const isSynced = serverChat && stableStringify(chat.filledSchema) === stableStringify(serverChat.filledSchema);
                    const isSelected = selectedChats.includes(chat.id);
                    const updateStatus = updatedChats[chat.id];

                    let bgColor = 'bg-blue-950'; // Darker base blue
                    let hoverBgColor = 'hover:bg-blue-900';
                    let iconHoverBgColor = 'hover:bg-blue-750';

                    if (chat.implemented) {
                        bgColor = 'bg-green-950';
                        hoverBgColor = 'hover:bg-green-900'; // Darker hover green
                        iconHoverBgColor = 'hover:bg-green-800';
                    } else if (isSynced) {
                        bgColor = 'bg-gray-800';
                        hoverBgColor = 'hover:bg-gray-700';
                        iconHoverBgColor = 'hover:bg-gray-600';
                    }

                    if (isSelected) {
                        if (chat.implemented) {
                            bgColor = 'bg-green-700'; // Lighter selected green
                        } else if (isSynced) {
                            bgColor = 'bg-gray-600'; // Lighter selected gray
                        } else {
                            bgColor = 'bg-blue-700'; // Lighter selected blue
                        }
                    }

                    return (
                        <div key={chat.id} 
                             ref={el => gridItemRefs.current[chat.id] = el}
                             onClick={() => onSelect(chat.id)}
                             className={`relative p-4 rounded-lg cursor-pointer ${!isSelected && hoverBgColor} transition-colors duration-200 ${bgColor} h-36 flex flex-col justify-between max-w-lg`}>
                            {updateStatus && !isSelected && (
                                <div className={`absolute top-2 right-2 w-2 h-2 ${updateStatus === 'green' ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                            )}
                            <div className="overflow-hidden">
                                <h3 className="text-md font-bold text-white truncate">{chat.name}</h3>
                                <p className="text-sm text-gray-400 mt-1 truncate">{chat.filledSchema?.event_description || 'No description'}</p>
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {chat.filledSchema?.event_type && <span className="px-2 py-1 text-xs rounded-full bg-purple-600 text-white">{chat.filledSchema.event_type}</span>}
                                    {chat.filledSchema?.event_action && <span className="px-2 py-1 text-xs rounded-full bg-teal-600 text-white">{chat.filledSchema.event_action}</span>}
                                </div>
                            </div>
                            <div className="flex justify-end items-center mt-2">
                                <div className="flex space-x-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelectChat(chat);
                                        }}
                                        title="View Details"
                                        className={`p-1 rounded-full ${iconHoverBgColor} transition-colors duration-200`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (chat.implemented) {
                                                onUnimplement(chat.id);
                                            } else {
                                                onOverride(chat.id);
                                            }
                                        }}
                                        title={chat.implemented ? "Mark as Not Implemented" : "Override Implementation"}
                                        className={`p-1 rounded-full ${iconHoverBgColor} transition-colors duration-200 group`}>
                                        {chat.implemented ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white group-hover:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white group-hover:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); onSync(chat.id) }} title="Sync to Server" className={`p-1 rounded-full ${iconHoverBgColor} transition-colors duration-200`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                                        </svg>
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); onDelete(chat.id) }} title="Delete Locally" className={`p-1 rounded-full ${iconHoverBgColor} transition-colors duration-200`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm-1 3a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const activeOriginalFile = originalFiles.find(f => activeDiffTab.includes(f.filePath));
    const activePendingChange = pendingChanges.find(f => activeDiffTab.includes(f.filePath));

    const SchemaModal = ({ chat, onClose, useClaude }) => {
        const [localSchemaView, setLocalSchemaView] = useState('split');
        const [localAnimatedSchema, setLocalAnimatedSchema] = useState(chat.filledSchema);
        const [localHighlightedPaths, setLocalHighlightedPaths] = useState([]);

        if (!chat) return null;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-2xl flex flex-col w-full max-w-4xl h-full max-h-[90vh]">
                    <div className="flex justify-between items-center p-3 border-b border-gray-800 flex-shrink-0">
                        <h2 className="text-base font-semibold text-gray-100">{chat.name}</h2>
                        <div className="flex space-x-1">
                            <button onClick={() => setLocalSchemaView('raw')} className={`px-2 py-1 text-xs rounded ${localSchemaView === 'raw' ? 'bg-gray-700' : 'bg-gray-800'}`}>Raw</button>
                            <button onClick={() => setLocalSchemaView('split')} className={`px-2 py-1 text-xs rounded ${localSchemaView === 'split' ? 'bg-gray-700' : 'bg-gray-800'}`}>Split</button>
                            <button onClick={() => setLocalSchemaView('visualized')} className={`px-2 py-1 text-xs rounded ${localSchemaView === 'visualized' ? 'bg-gray-700' : 'bg-gray-800'}`}>Visualized</button>
                        </div>
                        <button onClick={onClose} className="text-gray-400 hover:text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="flex-grow overflow-y-auto no-scrollbar filled-schema-panel">
                        {localSchemaView === 'raw' && (
                            <div className="flex-grow flex flex-col bg-gray-900">
                                <pre className="flex-grow bg-gray-900 text-xs text-gray-300 p-3 overflow-auto whitespace-pre-wrap break-all font-mono no-scrollbar">
                                    {JSON.stringify(chat.filledSchema, null, 2)}
                                </pre>
                            </div>
                        )}
                        {localSchemaView === 'split' && (
                            <div className="flex-grow flex h-full overflow-hidden">
                                <div className="w-1/2 h-full flex flex-col border-r border-gray-800">
                                    <pre className="flex-grow bg-gray-900 text-xs text-gray-300 p-3 overflow-auto whitespace-pre-wrap break-all font-mono no-scrollbar">
                                        {JSON.stringify(chat.filledSchema, null, 2)}
                                    </pre>
                                </div>
                                <div className="w-1/2 h-full flex flex-col">
                                    <div className="flex-grow bg-gray-900 text-xs text-gray-300 overflow-auto font-mono no-scrollbar">
                                        <VisualizedSchemaView data={localAnimatedSchema} highlightedPaths={localHighlightedPaths} useClaude={useClaude} />
                                    </div>
                                </div>
                            </div>
                        )}
                        {localSchemaView === 'visualized' && (
                            <div className="flex-grow bg-gray-900 text-xs text-gray-300 overflow-auto font-mono no-scrollbar">
                                <VisualizedSchemaView data={localAnimatedSchema} highlightedPaths={localHighlightedPaths} useClaude={useClaude} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // const filteredChats = chats.filter(chat =>
    //     chat.name.toLowerCase().includes(searchTerm.toLowerCase())
    // );

    const numSelectedInFiltered = filteredGridChats.filter(c => selectedGridChats.includes(c.id)).length;

    return (
        <div className="dark bg-gray-950 text-gray-200 h-screen flex font-sans text-sm">
            <Notification
                message={notification.message}
                type={notification.type}
                onDismiss={() => setNotification({ message: '', type: '' })}
            />
            <aside className="w-64 bg-gray-900 p-3 flex flex-col border-r border-gray-800">
                <div className="flex-shrink-0">
                    <div className="flex justify-between items-center mb-4">
                        <h1 className="text-lg font-semibold text-gray-100">Event Schemas</h1>

                    </div>
                    <div className="flex mb-2">
                        <button
                            className="flex-grow bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-3 rounded-l-md transition-colors duration-200 flex items-center justify-center"
                            onClick={handleNewChat}
                            disabled={loading}
                        >
                            {loading && !currentChat ? (
                                <svg className="animate-spin h-4 w-4 mr-2 text-white" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                'New Event'
                            )}
                        </button>
                        <button
                            className="w-auto bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-3 rounded-r-md transition-colors duration-200 flex items-center justify-center border-l border-gray-700"
                            onClick={() => batchFileInputRef.current.click()}
                            disabled={loading}
                            title="Batch create from txt file"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
                    <div className="flex flex-nowrap justify-between mb-4 space-x-2 transition-all duration-300 ease-in-out overflow-hidden">
                        {!showSearch ? (
                            <>
                                <button
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-2 rounded-md transition-colors duration-200 flex items-center justify-center"
                                    onClick={handleReloadFromServer}
                                    title="Reload from Server"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.212.723A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.723-1.212z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                <button
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-2 rounded-md transition-colors duration-200 flex items-center justify-center"
                                    onClick={handleDeleteAllLocalEvents}
                                    title="Delete All Local Events"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm-1 3a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                <button
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-2 rounded-md transition-colors duration-200 flex items-center justify-center"
                                    onClick={handleSyncAllToServer}
                                    title="Sync All to Server"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                                    </svg>
                                </button>
                                <button
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-2 rounded-md transition-colors duration-200 flex items-center justify-center relative"
                                    onClick={handleClearServerMemory}
                                    title="Clear Server Memory"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm-1 3a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute bottom-0 right-0 -mb-0.5 -mr-0.5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                                    </svg>
                                </button>
                                <button
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-2 rounded-md transition-colors duration-200 flex items-center justify-center"
                                    onClick={() => setShowSearch(true)}
                                    title="Search Events"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            </>
                        ) : (
                            <div className="flex items-center w-full transition-all duration-300 ease-in-out">
                                <button
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-2 rounded-md transition-colors duration-200 mr-2"
                                    onClick={() => {
                                        setShowSearch(false);
                                        setSearchTerm('');
                                    }}
                                    title="Back to Actions"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                <input
                                    type="text"
                                    placeholder="Search events..."
                                    className="flex-grow bg-gray-800 text-gray-100 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-700"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                        )}
                    </div>
                </div>
                <ul className="flex-grow overflow-y-auto space-y-1 dark-scrollbar">
                    {filteredChats.map(chat => (
                        <li
                            key={chat.id}
                            className={`group flex items-center justify-between cursor-pointer p-2 rounded-md transition-colors duration-200 ${currentChat?.id === chat.id ? 'bg-gray-700 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
                            onMouseLeave={() => {
                                setActiveMenuChatId(null);
                                setIsRightClickMenu(false);
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setActiveMenuChatId(chat.id);
                                setMenuPosition({ x: e.clientX, y: e.clientY });
                                setIsRightClickMenu(true);
                            }}
                        >

                            <span onClick={() => handleSelectChatAndExitVisualize(chat)} className="flex-grow text-sm truncate">
                                {chat.name}
                            </span>
                            <div className="relative flex items-center">
                                {chat.isNew && (
                                    <span className="absolute top-1/2 right-3 transform -translate-y-1/2 w-2 h-2 bg-blue-500 rounded-full group-hover:hidden"></span>
                                )}
                                <button
                                    onClick={() => {
                                        setActiveMenuChatId(activeMenuChatId === chat.id ? null : chat.id);
                                        setIsRightClickMenu(false);
                                    }}
                                    className="ml-4 p-1 rounded-md hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                                    title="More options"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 group-hover:text-white" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM18 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                    </svg>
                                </button>
                                {activeMenuChatId === chat.id && (
                                    <div
                                        className={`w-48 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-10 ${isRightClickMenu ? '' : 'absolute right-0 top-full mt-2'}`}
                                        style={isRightClickMenu ? {
                                            position: 'fixed',
                                            left: menuPosition.x,
                                            top: menuPosition.y
                                        } : {}}
                                    >
                                        <button
                                            onClick={() => handleSyncChatToServer(chat.id)}
                                            className="flex items-center w-full px-3 py-2 text-sm text-left text-gray-200 hover:bg-gray-700"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                                            </svg>
                                            Sync to Server
                                        </button>
                                        <button
                                            onClick={() => handleDeleteChatFromServer(chat.id)}
                                            className="flex items-center w-full px-3 py-2 text-sm text-left text-gray-200 hover:bg-gray-700"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm-1 3a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                                            </svg>
                                            Delete from Server
                                        </button>
                                        <button
                                            onClick={() => handleDeleteChat(chat.id)}
                                            className="flex items-center w-full px-3 py-2 text-sm text-left text-gray-200 hover:bg-gray-700"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                            Delete Locally
                                        </button>
                                    </div>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="mt-auto pt-3 border-t border-gray-800 -mx-3">
                    <div className="space-y-2 px-3">
                        <button
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center justify-center"
                            onClick={handleGenerateReport}
                            disabled={isValidating}
                            title="Generate Report"
                        >
                            {isValidating ? (
                                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                'Generate Report'
                            )}
                        </button>
                        <button
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center justify-center mt-2"
                            onClick={() => setVisualizeMode(!visualizeMode)}
                            title="Visualize Events"
                        >
                            {visualizeMode ? 'Exit Visualization' : 'Visualize'}
                        </button>
                        <button
                            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center justify-center"
                            onClick={handleDownloadAllSchemas}
                            title="Download All Local Schemas"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                            </svg>
                            Download Schemas
                        </button>
                        <button
                            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center justify-center"
                            onClick={handleBackupServer}
                            title="Backup Server Data"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4 4h16v2H4zm0 4h16v2H4zm0 4h16v2H4zm0 4h16v2H4z" />
                            </svg>
                            Backup Server
                        </button>
                    </div>
                </div>
            </aside>
            <div className="flex-1 flex h-screen bg-gray-950 p-4 gap-4 overflow-hidden">
                {isModalOpen && modalChat && (
                    <SchemaModal chat={modalChat} onClose={() => setIsModalOpen(false)} useClaude={useClaude} />
                )}
                {visualizeMode ? (
                    <div className="flex flex-col w-full h-full">
                        <FilterControls types={allEventTypes} actions={allEventActions} activeFilters={activeFilters} setActiveFilters={setActiveFilters} onSelectAll={handleGridSelectAll} numSelected={numSelectedInFiltered} numTotal={filteredGridChats.length} />
                        <div className="flex-grow overflow-y-auto">
                            <EventGrid key={gridVersion} chats={filteredGridChats} onSelectChat={handleSelectChatFromGrid} serverChats={serverChats} onOverride={handleOverrideImplementation} onUnimplement={handleUnimplement} onSync={handleSyncChatToServer} onDelete={handleDeleteChat} activeFilters={activeFilters} selectedChats={selectedGridChats} onSelect={handleGridItemSelect} />
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Conversation and Diff Column */}
                        <div className="flex flex-col w-1/2 h-full bg-gray-900 rounded-none border border-gray-800">
                            {showDiffPanel ? (
                                <div className="flex flex-col flex-1 h-full bg-gray-900 rounded-none border border-gray-800">
                                    <div className="flex justify-between items-center p-3 border-b border-gray-800">
                                        <h2 className="text-base font-semibold text-gray-100">Diff</h2>
                                        <button onClick={() => setShowDiffPanel(false)} className="text-gray-400 hover:text-white">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                    <div className="flex border-b border-gray-800">
                                        {pendingChanges.map(change => (
                                            <button
                                                key={change.filePath}
                                                onClick={() => setActiveDiffTab(change.filePath)}
                                                className={`px-4 py-2 text-sm font-medium ${activeDiffTab === change.filePath ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                                            >
                                                {change.filePath.split('/').pop()}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex-grow overflow-auto no-scrollbar">
                                        {activeOriginalFile && activePendingChange && (
                                            <ReactDiffViewer
                                                oldValue={normalizeNewlines(activeOriginalFile ? activeOriginalFile.content : '')}
                                                newValue={normalizeNewlines(activePendingChange ? activePendingChange.modifiedContent : '')}
                                                splitView={true}
                                                useDarkTheme={true}
                                                styles={{
                                                    diffContainer: { backgroundColor: '#1f2937' }, /* gray-800 */
                                                    diffRemoved: { backgroundColor: '#4a0e0b' }, /* dark red */
                                                    diffAdded: { backgroundColor: '#0c4a2e' }, /* dark green */
                                                    line: { color: '#e2e8f0' }, /* slate-200 */
                                                    gutter: { color: '#94a3b8' }, /* slate-400 */
                                                }}
                                            />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h2 className="text-base font-semibold p-3 border-b border-gray-800 text-gray-100">Conversation</h2>
                                    <div ref={chatContainerRef} className="flex-grow overflow-y-auto p-3 space-y-4 no-scrollbar">
                                        {currentChat ? (
                                            currentChat.messages.map((message, index) => (
                                                <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                    <div className={`max-w-[75%] p-3 rounded-lg ${message.role === 'user' ? 'bg-gray-700 text-gray-100' : 'bg-gray-800 text-gray-200'}`}>
                                                        {message.content}
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-gray-500 text-lg">
                                                <p>Select an event or start a new one</p>
                                            </div>
                                        )}
                                        {isCodeAgentTyping && (
                                            <div className="flex justify-start">
                                                <div className="max-w-[75%] p-3 rounded-lg bg-gray-800 text-gray-200">
                                                    <div className="typing-indicator">
                                                        <span></span>
                                                        <span></span>
                                                        <span></span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {/* Prompt Input Area */}
                                    <div className="p-4 bg-gray-950 border-t border-gray-800">
                                        {attachedFile && (
                                            <div className="flex items-center justify-between p-2 mb-2 bg-gray-800 rounded-md border border-gray-700">
                                                <span className="text-gray-300 text-sm truncate">Attached: {attachedFile.name}</span>
                                                <button
                                                    onClick={handleRemoveAttachedFile}
                                                    className="ml-2 p-1 rounded-full hover:bg-gray-700 text-gray-400 hover:text-white relative"
                                                    title="Remove attached file"
                                                    disabled={isFileProcessing}
                                                >
                                                    {isFileProcessing && (
                                                        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 36 36">
                                                            <circle
                                                                className="text-gray-700"
                                                                stroke="currentColor"
                                                                strokeWidth="3"
                                                                fill="none"
                                                                r="16"
                                                                cx="18"
                                                                cy="18"
                                                            ></circle>
                                                            <circle
                                                                className="text-white"
                                                                stroke="currentColor"
                                                                strokeWidth="3"
                                                                fill="none"
                                                                r="16"
                                                                cx="18"
                                                                cy="18"
                                                                strokeDasharray="100"
                                                                strokeDashoffset={100 - fileLoadingProgress}
                                                                transform="rotate(-90 18 18)"
                                                            ></circle>
                                                        </svg>
                                                    )}
                                                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isFileProcessing ? 'opacity-0' : 'opacity-100'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        )}
                                        {useCodeAgent && (
                                            <div className="flex items-center p-2 mb-2 bg-blue-900 bg-opacity-50 rounded-md border border-blue-700">
                                                <span className="text-blue-300 text-sm font-medium">Code Agent</span>
                                            </div>
                                        )}
                                        <div className="relative flex items-center bg-gray-900 rounded-md border border-gray-700 p-2">
                                            <textarea
                                                className="flex-grow bg-transparent text-gray-200 p-2 pr-20 focus:outline-none resize-none placeholder-gray-500"
                                                value={prompt}
                                                onChange={handlePromptChange}
                                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                                                placeholder="Describe the event you want to create..."
                                                disabled={loading}
                                                rows="5" />
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                style={{ display: 'none' }}
                                                onChange={handleFileChange} />
                                            <input
                                                type="file"
                                                ref={batchFileInputRef}
                                                style={{ display: 'none' }}
                                                onChange={handleBatchUpload}
                                                accept=".txt" />
                                            <button
                                                className="absolute left-2 bottom-2 bg-gray-900 hover:bg-gray-700 text-gray-100 font-medium p-2 rounded-full transition-colors duration-200 disabled:bg-gray-800 disabled:cursor-not-allowed"
                                                title="Attach file"
                                                onClick={handleAttachFile}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                            <button
                                                className="absolute left-12 bottom-2 bg-gray-900 hover:bg-gray-700 text-gray-100 font-medium w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-200 disabled:bg-gray-800 disabled:cursor-not-allowed"
                                                title="Toggle Code Agent"
                                                onClick={() => setUseCodeAgent(!useCodeAgent)}
                                            >
                                                <span className={`text-2xl ${useCodeAgent ? 'text-blue-500' : ''}`} style={{ position: 'relative', top: '-1px' }}>✦</span>
                                            </button>
                                            <button
                                                className="absolute right-12 bottom-2 bg-gray-900 hover:bg-gray-700 text-gray-100 font-medium p-2 rounded-full transition-colors duration-200 disabled:bg-gray-800 disabled:cursor-not-allowed"
                                                title="Start voice input"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
                                                </svg>
                                            </button>
                                            <button
                                                className="absolute right-2 bottom-2 font-medium p-2 rounded-full transition-colors duration-200 disabled:bg-gray-700 disabled:text-gray-100 disabled:cursor-not-allowed bg-white hover:bg-gray-300 text-gray-900"
                                                onClick={handleSubmit}
                                                disabled={loading || !prompt.trim()}
                                            >
                                                {loading ? (
                                                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                ) : (
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                                        <path fillRule="evenodd" d="M12 18a1 1 0 0 1-1-1V7.414l-3.293 3.293a1 1 0 0 1-1.414-1.414l5-5a1 1 0 0 1 1.414 0l5 5a1 1 0 1 1-1.414 1.414L13 7.414V17a1 1 0 0 1-1 1z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Filled Schema Column */}
                        <div className="flex flex-col flex-1 h-full bg-gray-900 rounded-none border border-gray-800">
                            <div className="flex-grow overflow-y-auto no-scrollbar filled-schema-panel">
                                {showCodeAgentDiff ? (
                                    <div className="flex flex-col flex-1 h-full bg-gray-900 rounded-none border border-gray-800">
                                        <div className="flex justify-between items-center p-3 border-b border-gray-800">
                                            <h2 className="text-base font-semibold text-gray-100">Code Agent Diff</h2>
                                            <button onClick={() => {
                                                setShowCodeAgentDiff(false);
                                                setPendingChanges([]);
                                                setOriginalFiles([]);
                                                setActiveDiffTab('');
                                            }} className="text-gray-400 hover:text-white">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                        <div className="flex border-b border-gray-800">
                                            {pendingChanges.map(change => (
                                                <button
                                                    key={change.filePath}
                                                    onClick={() => setActiveDiffTab(change.filePath)}
                                                    className={`px-4 py-2 text-sm font-medium ${activeDiffTab === change.filePath ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                                                >
                                                    {change.filePath.split('/').pop()}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex-grow overflow-auto no-scrollbar">
                                            {activeOriginalFile && activePendingChange && (
                                                <ReactDiffViewer
                                                    oldValue={normalizeNewlines(activeOriginalFile ? activeOriginalFile.content : '')}
                                                    newValue={normalizeNewlines(activePendingChange ? activePendingChange.modifiedContent : '')}
                                                    splitView={true}
                                                    useDarkTheme={true}
                                                    styles={{
                                                        diffContainer: { backgroundColor: '#1f2937' },
                                                        diffRemoved: { backgroundColor: '#4a0e0b' },
                                                        diffAdded: { backgroundColor: '#0c4a2e' },
                                                        line: { color: '#e2e8f0' },
                                                        gutter: { color: '#94a3b8' },
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex justify-between items-center p-3 border-b border-gray-800">
                                            <h2 className="text-base font-semibold text-gray-100">Filled Schema</h2>
                                            <div className="flex space-x-1">
                                                <button onClick={() => setSchemaView('raw')} className={`px-2 py-1 text-xs rounded ${schemaView === 'raw' ? 'bg-gray-700' : 'bg-gray-800'}`}>Raw</button>
                                                <button onClick={() => setSchemaView('split')} className={`px-2 py-1 text-xs rounded ${schemaView === 'split' ? 'bg-gray-700' : 'bg-gray-800'}`}>Split</button>
                                                <button onClick={() => setSchemaView('visualized')} className={`px-2 py-1 text-xs rounded ${schemaView === 'visualized' ? 'bg-gray-700' : 'bg-gray-800'}`}>Visualized</button>
                                            </div>
                                        </div>
                                        {schemaView === 'raw' && (
                                            <div className="flex-grow flex flex-col bg-gray-900">
                                                <pre className="flex-grow bg-gray-900 text-xs text-gray-300 p-3 overflow-auto whitespace-pre-wrap break-all font-mono no-scrollbar">
                                                    {currentChat ? displayedLines.map((line, index) => (
                                                        <div key={index} className={`transition-colors duration-200 ${line.highlight ? 'bg-yellow-500 bg-opacity-20' : ''}`}>
                                                            {line.text}
                                                        </div>
                                                    )) : <span className="text-gray-500">Schema will appear here...</span>}
                                                </pre>
                                            </div>
                                        )}
                                        {schemaView === 'split' && (
                                            <div className="flex-grow flex h-full overflow-hidden">
                                                {currentChat ? (
                                                    <>
                                                        {/* Left side: Raw Base Schema */}
                                                        <div className="w-1/2 h-full flex flex-col border-r border-gray-800">
                                                            <pre className="flex-grow bg-gray-900 text-xs text-gray-300 p-3 overflow-auto whitespace-pre-wrap break-all font-mono no-scrollbar">
                                                                {currentChat ? displayedLines.map((line, index) => (
                                                                    <div key={index} className={`transition-colors duration-200 ${line.highlight ? 'bg-yellow-500 bg-opacity-20' : ''}`}>
                                                                        {line.text}
                                                                    </div>
                                                                )) : <span className="text-gray-500">Schema will appear here...</span>}
                                                            </pre>
                                                        </div>
                                                        {/* Right side: Visualized Filled Schema */}
                                                        <div className="w-1/2 h-full flex flex-col">
                                                            <div className="flex-grow bg-gray-900 text-xs text-gray-300 overflow-auto font-mono no-scrollbar">
                                                                <VisualizedSchemaView data={animatedSchema} highlightedPaths={highlightedPaths} useClaude={useClaude} />
                                                            </div>
                                                        </div>
                                                    </>
                                                ) : <span className="text-gray-500 p-3">Select a chat to see the split view.</span>}
                                            </div>
                                        )}
                                        {schemaView === 'visualized' && (
                                            <div className="flex-grow bg-gray-900 text-xs text-gray-300 overflow-auto font-mono no-scrollbar">
                                                <VisualizedSchemaView data={animatedSchema} highlightedPaths={highlightedPaths} useClaude={useClaude} />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="p-4 bg-gray-950 border-t border-gray-800">
                                <div className="flex items-center mb-2">
                                    <input
                                        type="checkbox"
                                        id="novoSwitch"
                                        className={`form-checkbox h-4 w-4 ${useClaude ? 'text-orange-600' : 'text-purple-600'} transition duration-150 ease-in-out`}
                                        checked={isNovo}
                                        onChange={(e) => setIsNovo(e.target.checked)}
                                        disabled={loading || injecting}
                                    />
                                    <label htmlFor="novoSwitch" className="ml-2 text-gray-300 text-sm">Are you working with Novo?</label>
                                    <div className="flex items-center ml-auto">
                                        <input
                                            type="checkbox"
                                            id="cliSwitch"
                                            className={`form-checkbox h-4 w-4 ${useClaude ? 'text-orange-600' : 'text-purple-600'} transition duration-150 ease-in-out mr-2`}
                                            checked={useCli}
                                            onChange={(e) => setUseCli(e.target.checked)}
                                            disabled={loading || injecting}
                                        />
                                        <label htmlFor="cliSwitch" className="text-gray-300 text-sm" style={{ marginRight: 20 }}>Use CLI?</label>
                                        {useCli && (
                                            <div className="flex items-center ml-4 space-x-2">
                                                <span className={`text-sm font-medium transition-colors duration-300 ${!useClaude ? 'text-purple-400' : 'text-gray-500'}`}>Gemini</span>
                                                <div className="relative inline-block w-10 align-middle select-none transition duration-200 ease-in">
                                                    <input type="checkbox" name="toggle" id="toggle" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" checked={useClaude} onChange={() => setUseClaude(!useClaude)} />
                                                    <label htmlFor="toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                                                </div>
                                                <span className={`text-sm font-medium transition-colors duration-300 ${useClaude ? 'text-orange-400' : 'text-gray-500'}`}>Claude</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center mb-2">
                                    <input
                                        type="text"
                                        placeholder="Select a folder or enter a local route for logging injection..."
                                        className="flex-grow bg-gray-800 text-gray-100 p-2 rounded-l-md focus:outline-none focus:ring-2 focus:ring-gray-700"
                                        value={localRoute}
                                        onChange={(e) => setLocalRoute(e.target.value)}
                                        disabled={loading || injecting || directoryHandle !== null}
                                        readOnly={directoryHandle !== null}
                                    />
                                    <button
                                        className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-r-md transition-colors duration-200 disabled:bg-gray-800 disabled:cursor-not-allowed"
                                        onClick={handleSelectFolder}
                                        disabled={loading || injecting}
                                        title="Select a folder from your local file system"
                                    >
                                        Select Folder
                                    </button>
                                </div>
                                <button
                                    className={`w-full font-medium py-2 px-4 rounded-md transition-colors duration-200 flex items-center justify-center ${(currentChat?.filledSchema && localRoute.trim()) ? 'bg-white hover:bg-gray-300 text-gray-900' : 'bg-gray-800 text-gray-100'} disabled:bg-gray-800 disabled:cursor-not-allowed`}
                                    onClick={handleInjectLogging}
                                    disabled={!currentChat || loading || injecting || !localRoute.trim() || !currentChat.filledSchema}
                                >
                                    {injecting ? (
                                        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        'Inject Logging'
                                    )}
                                </button>
                                <button
                                    className={`w-full font-medium py-2 px-4 rounded-md transition-colors duration-200 mt-2 ${pendingChanges.length > 0 ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-800 text-gray-100'} disabled:bg-gray-800 disabled:cursor-not-allowed`}
                                    onClick={handleApproveChanges}
                                    disabled={loading || injecting || pendingChanges.length === 0}
                                >
                                    Approve Changes
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default App;
