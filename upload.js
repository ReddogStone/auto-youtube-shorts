// YouTube API video uploader using JavaScript/Node.js
// You can find the full visual guide at: https://www.youtube.com/watch?v=gncPwSEzq1s
// You can find the brief written guide at: https://quanticdev.com/articles/automating-my-youtube-uploads-using-nodejs
//
// Upload code is adapted from: https://developers.google.com/youtube/v3/quickstart/nodejs

import fs from "fs";
import readline from "readline";
import assert from "assert";
import { google } from "googleapis";
const OAuth2 = google.auth.OAuth2;

// video category IDs for YouTube:
const categoryIds = {
	Entertainment: 24,
	Education: 27,
	ScienceTechnology: 28,
};

// If modifying these scopes, delete your previously saved credentials in client_oauth_token.json
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];
const TOKEN_PATH = "./" + "client_oauth_token.json";

const videoFilePath = "./output.mp4";
const detailsFilePath = "./details.json";

async function doUploadVideo() {
	assert(fs.existsSync(videoFilePath));

	const details = JSON.parse(
		await fs.promises.readFile(detailsFilePath, "utf8")
	);

	// Load client secrets from a local file.
	const content = await fs.promises.readFile("./client_secret.json");

	// Authorize a client with the loaded credentials, then call the YouTube API.
	const auth = await authorize(JSON.parse(content));
	await uploadVideo(auth, details.title, "", []);
}

/**
 * Upload the video file.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function uploadVideo(auth, title, description, tags) {
	const service = google.youtube("v3");

	console.log("Uploading video...");

	return new Promise((resolve, reject) => {
		service.videos.insert(
			{
				auth: auth,
				part: "snippet,status",
				requestBody: {
					snippet: {
						title,
						description,
						tags,
						categoryId: categoryIds.ScienceTechnology,
						defaultLanguage: "en",
						defaultAudioLanguage: "en",
					},
					status: {
						privacyStatus: "private",
					},
				},
				media: {
					body: fs.createReadStream(videoFilePath),
				},
			},
			(err, response) => {
				if (err) return reject(err);

				console.log(response.data);
				console.log("Video uploaded.");

				resolve();
			}
		);
	});
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 */
async function authorize(credentials) {
	const clientSecret = credentials.installed.client_secret;
	const clientId = credentials.installed.client_id;
	const redirectUrl = credentials.installed.redirect_uris[0];
	const oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);

	// Check if we have previously stored a token.
	let token;

	try {
		token = await fs.promises.readFile(TOKEN_PATH);
		oauth2Client.credentials = JSON.parse(token);
		return oauth2Client;
	} catch (e) {
		return await getNewToken(oauth2Client);
	}
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 */
async function getNewToken(oauth2Client) {
	const authUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: SCOPES,
	});
	console.log("Authorize this app by visiting this url: ", authUrl);
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve, reject) => {
		rl.question("Enter the code from that page here: ", function (code) {
			rl.close();
			oauth2Client.getToken(code, async function (err, token) {
				if (err) return reject(err);

				oauth2Client.credentials = token;
				await storeToken(token);
				resolve(oauth2Client);
			});
		});
	});
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
async function storeToken(token) {
	await fs.promises.writeFile(TOKEN_PATH, JSON.stringify(token));
	console.log("Token stored to " + TOKEN_PATH);
}

doUploadVideo();
