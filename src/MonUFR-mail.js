import https from "https";
import fs from 'fs';
import imaps from 'imap-simple';
import * as dotenv from 'dotenv';

dotenv.config();

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');

https.createServer(
    {
        key: fs.readFileSync(process.env.SSL_PRIVATEKEY),
        cert: fs.readFileSync(process.env.SSL_FULLCHAIN),
    }, 
    async (request, response) => {
    if(request.method != "GET") {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
        });
        response.end(`${request.method} from origin ${request.headers.origin} is not allowed for the request.`);
        return false;
    }

    if(!allowedOrigins.includes(request.headers.origin)) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
        });
        response.end(`Origin ${request.headers.origin} is not allowed for the request.`);
        return false;
    }

    let urlParams = parseUrl(request.url);
    if(!urlParams.action) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("Request action is not defined !");
        return false;
    }

    if(!urlParams.id) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("User id is not defined !");
        return false;
    }

    if(!urlParams.password) {
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
        });
        response.end("User password is not defined !");
        return false;
    }

    let result = await new MailManager(urlParams.action, urlParams.id, urlParams.password, urlParams).treatAction();

    response.writeHead(200, {
        "Access-Control-Allow-Origin": request.headers.origin,
        "Access-Control-Allow-Methods": "GET",
    });
    response.end(JSON.stringify(result));
}).listen(process.env.SERVER_PORT);

function parseUrl(url) {
    let urlData = {};

    url = url.slice(2, url.length);
    let array = url.split('&');

    for(let i = 0; i < array.length; i++) {
        let equalIndex = array[i].indexOf("=");
        let key = array[i].slice(0, equalIndex);
        let value = array[i].slice(equalIndex + 1, array[i].length);

        urlData[key] = value;
    }

    return urlData;
}

class MailManager {
    constructor(action, id, password, urlParams) {
        this.action = action;
        this.id = decodeURI(id);
        this.password = decodeURI(password);

        this.urlParams = urlParams;
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
            let box = decodeURI(this.urlParams.box);
            let mailId = decodeURI(this.urlParams.mailId);

            if(!box || !mailId) return { status: "fail" };
            result = await this.getMail(connection, box, mailId);
        }

        if(this.action == "setRead") {
            let box = decodeURI(this.urlParams.box);
            let mailId = decodeURI(this.urlParams.mailId);

            if(!box || !mailId) return { status: "fail" };
            result = await this.setRead(connection, box, mailId);
        }

        if(this.action == "moveMail") {
            let box = decodeURI(this.urlParams.box);
            let newBox = decodeURI(this.urlParams.newBox);
            let mailId = decodeURI(this.urlParams.mailId);

            if(!box || !mailId || !newBox) return { status: "fail" };
            result = await this.moveMail(connection, box, newBox, mailId);
        }

        if(!result || result.status != "succes") {
            return { status: "fail" };
        }

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

        let mail = await this.downloadMail(connection, mailId);
        if(!mail || (Array.isArray(mail) && mail.length == 0)) return { status:"fail", content: "" };

        let mailsData = await this.parseMail(connection, mail);
        if(mailsData.status != "succes") return { status:"fail", content: "" };
        
        return { status:"succes", content: mailsData };
    }

    async setRead(connection, box, mailId) {
        await this.openBox(connection, box);
        let result = await connection.addFlags(decodeURI(mailId), "\\Seen").catch(() => { return { status: "fail" } });

        if(result && result.status && result.status != "succes") return result;
        return { status: "succes" };
    }

    async moveMail(connection, box, newBox, mailId) {
        console.log(newBox)

        await this.openBox(connection, box);
        let result = await connection.moveMessage(mailId, newBox).catch((error) => { console.log(error); return { status: "fail" }; });

        if(result && result.status && result.status != "succes") return result;
        return { status: "succes" };
    }

    async getBoxes(connection) {
        let boxes;
        try { boxes = await connection.getBoxes().catch(() => { return false; });
        } catch(e) { return false; }
        
        let searchedBoxes = [];
        let ignoredBoxes = ["Junk", "Draft", "Drafts", "Sent"];
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

    async downloadMail(connection, mailId) {
        return await connection.search([["UID", mailId + ""]], {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT CC)', 'TEXT'],
            struct: true,
        }).catch(() => { return false; });
    }

    async parseMail(connection, message) {
        let parsedMessage = {
            text: null,
            html: null,
            attachements: [],

            flags: message[0].attributes.flags,
            uid: message[0].attributes.uid,
            title: message[0].parts[0].body.subject,
            date: message[0].attributes.date,
            from: message[0].parts[0].body.from,
            to: message[0].parts[0].body.to,
            cc: message[0].parts[0].body.cc,
        };

        let parts;
        try { parts = await imaps.getParts(message[0].attributes.struct);
        } catch(e) { return { status: "succes", content: parsedMessage } }

        for(let j = 0; j < parts.length; j++) {
            if(parts[j].disposition && parts[j].disposition.type.toUpperCase() == 'ATTACHMENT') {
                let partData = await connection.getPartData(message[0], parts[j]).catch(() => { return { status: "fail" };; });

                if(partData) {
                    parsedMessage.attachements.push({
                        filename: parts[j].disposition.params.filename,
                        fileType: parts[j].subtype,
                        data: partData,
                    });
                }
            } else if(parts[j].subtype.toUpperCase() == 'HTML') {
                let partData = await connection.getPartData(message[0], parts[j]).catch(() => { return { status: "fail" }; });
                parsedMessage.html = partData;
            } else if(parts[j].subtype.toUpperCase() == 'PLAIN') {
                let partData = await connection.getPartData(message[0], parts[j]).catch(() => { return { status: "fail" }; });
                parsedMessage.text = partData;
            }
        }

        return { status: "succes", content: parsedMessage };
    }
}