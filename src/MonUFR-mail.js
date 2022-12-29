import https from "https";

import fs from 'fs';
import imaps from 'imap-simple';
import dotenv from 'dotenv';

// Activate dotenv
dotenv.config();

// Create global variables
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');

const serverOptions = {
    key: fs.readFileSync(process.env.SSL_PRIVATEKEY),
    cert: fs.readFileSync(process.env.SSL_FULLCHAIN),
};

https.createServer(
    serverOptions,

    async (request, response) => {
    // Check if request method is different than GET
    if(request.method != "GET") {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
        });
        response.end(`${request.method} from origin ${request.headers.origin} is not allowed for the request.`);
        return false;
    }

    //Check if origin is allowed
    if(!allowedOrigins.includes(request.headers.origin)) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
        });
        response.end(`Origin ${request.headers.origin} is not allowed for the request.`);
        return false;
    }

    //Check if if url is valid
    let requestUrl;
    try {
        requestUrl = new URL("https://server.ufr-planning.com" + request.url);
    } catch(error) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": request.headers.origin,
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("Url is not valid.");
        return false;
    }

    // if(request.url == "/favicon.ico") { // ------> remove
    //     response.writeHead(200, {
    //         "Access-Control-Allow-Origin": "*",
    //         "Access-Control-Allow-Methods": "GET",
    //     });
    //     response.end("Request action is not defined.");
    //     return false;
    // }

    // Check if requested url params are present
    let requestAction = requestUrl.searchParams.get("action");
    if(requestAction == null) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": request.headers.origin,
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("Request action is not defined.");
        return false;
    }
    
    let requestUserId = requestUrl.searchParams.get("id");
    if(requestUserId == null) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": request.headers.origin,
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("User id is not defined.");
        return false;
    }

    let requestUserPassword = requestUrl.searchParams.get("password");
    if(requestUserPassword == null) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": request.headers.origin,
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("User password is not defined.");
        return false;
    }

    let result = await new MailManager(requestAction, requestUserId, requestUserPassword, requestUrl.searchParams).treatAction();

    response.writeHead(200, {
        "Access-Control-Allow-Origin": request.headers.origin,
        "Access-Control-Allow-Methods": "GET",
    });
    response.end(JSON.stringify(result));
}).listen(process.env.SERVER_PORT);

class MailManager {
    constructor(action, id, password, searchParams) {
        this.action = action;
        this.id = id;
        this.password = password;

        this.searchParams = searchParams;
    }

    async treatAction() {
        let config = this.getConnectionConfig(this.id, this.password);

        let connection = await this.connect(config);
        if(!connection) return { status: "fail" };

        let result;
        if(this.action == "login") {
            result = { status: "succes", content: "", };
        }

        if(this.action == "hierarchy") {
            result = await this.getHierarchy(connection);
        }

        if(this.action == "getMail") {
            let box = this.searchParams.get("box");
            let mailId = this.searchParams.get("mailId");

            if(box == null || mailId == null || !box || !mailId) return { status: "fail" };
            result = await this.getMail(connection, box, mailId);
        }

        if(this.action == "getAttachment") {
            let box = this.searchParams.get("box");
            let mailId = this.searchParams.get("mailId");

            if(box == null || mailId == null || !box || !mailId) return { status: "fail" };
            result = await this.getAttachment(connection, box, mailId);
        }

        if(this.action == "setRead") {
            let box = this.searchParams.get("box");
            let mailId = this.searchParams.get("mailId");

            if(box == null || mailId == null || !box || !mailId) return { status: "fail" };
            result = await this.setRead(connection, box, mailId);
        }

        if(this.action == "moveMail") {
            let box = this.searchParams.get("box");
            let newBox = this.searchParams.get("newBox");
            let mailId = this.searchParams.get("mailId");

            if(box == null || newBox == null || mailId == null || !box || !mailId || !newBox) return { status: "fail" };
            result = await this.moveMail(connection, box, newBox, mailId);
        }

        if(!result || result.status != "succes") return { status: "fail" };

        connection.end();
        return { status: "succes", content: result.content };
    }

    getConnectionConfig(id, password) {
        return {
            imap: {
                user: id,
                password: password,
                host: 'imapetu.univ-tours.fr',
                port: 993,

                tls: {
                    secureProtocol: "TLSv1_method",
                }
            },
        }
    }

    async connect(config) {
        try { return await imaps.connect(config);
        } catch(e) { return false; }
    }

    async getHierarchy(connection) {
        let boxes = await this.getBoxes(connection).catch((error) => { return false; });
        if(!boxes) return { status: "fail" }

        let mailsId = await this.getMailsId(connection, boxes);
        if(!mailsId) return { status: "fail" }

        return { status: "succes", content: mailsId, };
    }

    async getMail(connection, box, mailId) {
        let state = await this.openBox(connection, box);
        if(!state) return { status:"fail", content: "" };
        
        let mailStruct = await this.downloadMailStruct(connection, mailId);
        if(!mailStruct || (Array.isArray(mailStruct) && mailStruct.length == 0)) return { status:"fail", content: "" };

        let getPartsResult = this.getMailParts(mailStruct);
        if(getPartsResult.status != "succes") return { status:"fail", content: "" };

        let parsingResult = this.parseMail(mailStruct, getPartsResult.content);
        if(parsingResult.status != "succes") return { status:"fail", content: "" };

        let mailContentResult = await this.downloadParts(connection, mailStruct, ["PLAIN", "HTML"], getPartsResult.content);
        if(mailContentResult.status != "succes") return { status:"fail", content: "" };

        let mailData = {
            ...parsingResult.content,
            ...mailContentResult.content,
        }
        
        return { status:"succes", content: mailData };
    }

    async getAttachment(connection, box, mailId) {
        let state = await this.openBox(connection, box);
        if(!state) return { status:"fail", content: "" };
        
        let mailStruct = await this.downloadMailStruct(connection, mailId);
        if(!mailStruct || (Array.isArray(mailStruct) && mailStruct.length == 0)) return { status:"fail", content: "" };

        let getPartsResult = this.getMailParts(mailStruct);
        if(getPartsResult.status != "succes") return { status:"fail", content: "" };

        let mailContentResult = await this.downloadParts(connection, mailStruct, ["ATTACHMENT"], getPartsResult.content);
        if(mailContentResult.status != "succes") return { status:"fail", content: "" };
        
        return { status:"succes", content: mailContentResult.content };
    }

    async setRead(connection, box, mailId) {
        await this.openBox(connection, box);
        let result = await connection.addFlags(mailId, "\\Seen").catch(() => { return { status: "fail" } });

        if(result && result.status && result.status != "succes") return result;
        return { status: "succes" };
    }

    async moveMail(connection, box, newBox, mailId) {
        await this.openBox(connection, box);
        let result = await connection.moveMessage(mailId, newBox).catch((error) => { return { status: "fail" }; });

        if(result && result.status && result.status != "succes") return result;
        return { status: "succes" };
    }

    async getBoxes(connection) {
        let boxes;
        try { boxes = await connection.getBoxes().catch(() => { return false; });
        } catch(e) { return false; }
        
        let searchedBoxes = [];
        let ignoredBoxes = ["Junk", "Draft", "Drafts"];
        let boxesKeys = Object.keys(boxes);

        for(let i = 0; i < boxesKeys.length; i++) {
            if(!ignoredBoxes.includes(boxesKeys[i])) {
                searchedBoxes.push(boxesKeys[i]);
            }
        }

        return searchedBoxes;
    }

    async openBox(connection, boxName) {
        try { await connection.openBox(boxName).catch(() => { return false; }); return true;
        } catch(e) { return false; }
    }

    async getMailsId(connection, boxes) {
        let mailsPerBox = {};
        for(let i = 0; i < boxes.length; i++) {
            let state = await this.openBox(connection, boxes[i]);
            if(!state) return false;

            let result = await this.loadMailsHeader(connection);
            if(!result) {
                continue;
            } else mailsPerBox[boxes[i]]  = result;
        }

        return mailsPerBox;
    }

    async loadMailsHeader(connection) {
        let mails = await connection.search(['ALL'], {
            bodies: ['HEADER.FIELDS (UID, FLAGS)'],
        }).catch(() => { return false; });

        let mailsId = [];
        for(let i = 0; i < mails.length; i++) {
            mailsId.push({
                id: mails[i].attributes.uid,
                flags: mails[i].attributes.flags,
            });
        }

        return mailsId.reverse();
    }

    async downloadMailStruct(connection, mailId) {
        return await connection.search([["UID", mailId + ""]], {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT CC ATTACHMENTS)'],
            struct: true,
        }).catch((error) => { return false; });
    }

    parseMail(message, parts) {
        let attachments = [];
        for(let j = 0; j < parts.length; j++) {
            if(parts[j].disposition && parts[j].disposition.type.toUpperCase() == 'ATTACHMENT') {
                attachments.push({
                    filename: parts[j].disposition.params.filename,
                    fileType: parts[j].subtype,
                });
            }
        }

        let parsedMessage = {
            flags: message[0].attributes.flags, // ----> remove after frontend update
            uid: message[0].attributes.uid,
            title: message[0].parts[0].body.subject,
            date: message[0].attributes.date,
            from: message[0].parts[0].body.from,
            to: message[0].parts[0].body.to,
            cc: message[0].parts[0].body.cc,
            attachments: attachments,
        };

        return { status: "succes", content: parsedMessage };
    }

    getMailParts(mailStruct) {
        let parts;
        try { parts = imaps.getParts(mailStruct[0].attributes.struct);
        } catch(e) { return { status: "succes", content: "" } }

        return { status: "succes", content: parts };
    }

    async downloadParts(connection, mailStruct, selectedParts, parts) {
        let partsData = {};

        for(let j = 0; j < parts.length; j++) {
            let partType;

            if(selectedParts.includes('ATTACHMENT') && parts[j].disposition) {
                partType = parts[j].disposition.type.toUpperCase();
                if(partType == 'ATTACHMENT') {
                    let partData = await connection.getPartData(mailStruct[0], parts[j]).catch(() => { return { status: "fail" };; });

                    if(partData) {
                        if(!partsData[partType]) partsData[partType] = [];

                        partsData[partType].push({
                            filename: parts[j].disposition.params.filename,
                            fileType: parts[j].subtype,
                            data: partData,
                        });
                    }
                }
            }

            partType = parts[j].subtype.toUpperCase();
            if((selectedParts.includes('HTML') || selectedParts.includes('PLAIN')) && ["PLAIN", "HTML"].includes(partType)) {
                partsData[partType] = await connection.getPartData(mailStruct[0], parts[j]).catch(() => { return { status: "fail" }; });
            }
        }

        return { status: "succes", content: partsData };
    }
}