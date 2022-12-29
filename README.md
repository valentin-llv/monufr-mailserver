# MonUFR mail server

This server is the brige between the IMAP mail server and the client app.

## Requiered libs
- nodemon
- dotenv

## Run in dev

```properties
npm run dev
```

OR

```properties
node src/MonUFR-mail.js
```

## Doc

A request is formed such as:

```properties
https://exemple.com?action={name of action}&id={user id}&password={user password}
```

This is the most basic request shape without any additionnal parameters. Additionnal parameters can be added folliwing the same format as for requiered params.

Exemple:

```
https://exemple.com?action={name of action}&id={user id}&password={user password}&param1={param 1 content}&param2={param2 content}
```

## Actions

There are several action type wich perform action or return data. Each action need one or more additionnal parameter to be performed.

The full list of actions can be find below.

<br />

### Login

Function to verify the id and password provided by the user.

**Action name**: login

**Params**: any additionnal params needed

**Response**: Is *true* if response status is succes

<br />

### Retrieve user mail box hierarchy

**Action name**: hierarchy

**Params**: any additionnal params needed

**Response**: Key-value map containing entry for each folder name. Each entry is an array containing array for each mail listing mail id and mail flags

<br />

### Download mail content

**Action name**: getMail

**Params**:
- box: name of the box the mail is in
- mailId: id of the mail

**Response**: Returns the mail content parsed as a jsopn object. Fields are:
- flags
- uid
- title
- date
- from
- to
- cc
- attachments: list of attachments names and type. See below to download attachments.

<br />

### Downloads attachments

**Action name**: getAttachment

**Params**:
- box: name of the box the mail is in
- mailId: id of the mail

**Response**: Return an array containing attachments name, type, and data. Data is usually encoded as BASE64.

<br />

### Mark a mail as read

**Action name**: setRead

**Params**:
- box: name of the box the mail is in
- mailId: id of the mail

**Response**: Is *true* if response status is succes

<br />

### Move a mail between box

**Action name**: moveMail

**Params**:
- box: name of the box the mail is in
- mailId: id of the mail
- newBox: name of the destination box

**Response**: Is *true* if response status is succes

## Response form

All response are JSON string and they share the same shape.

Key "status" contain the operation result status. 
If value is "succes" response data is available or the action as succefully been performed.
If value is "fail" response data is not available or the action failed to performed. It can be due to incorrect params or params encoding, or the server could not reach the imap server.

Key "content" contain the response data, field is full only if response "status" is "succes" and if the action type return data.