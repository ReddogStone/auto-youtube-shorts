import { exec } from "child_process";
import fs from "fs";
import OpenAI, { toFile } from "openai";
import { resolve } from "path";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
	apiKey: process.env.OPEN_AI_KEY,
});

async function generateText() {
	console.log("Generating facts...");
	const response = await openai.chat.completions.create({
		model: "gpt-4",
		messages: [
			{
				role: "user",
				content: `Generate 5 unexpected facts about job search in Europe.
					Your answer must be in the form of a JSON with following specification:
					{
						"title": string, // short clickbaity title to for a YouTube short video that will be generated from the facts
						"facts": string[], // array of the facts as plain strings
						"anecdote": string // a short anecdote that somehow touches on the provided facts
					}`,
			},
		],
	});

	return JSON.parse(response.choices[0].message.content);
}

async function generateAudio(text) {
	console.log("Generating audio...");
	const response = await openai.audio.speech.create({
		model: "tts-1",
		voice: "alloy",
		input: text,
		response_format: "mp3",
	});

	console.log("Creating buffer...");
	const buffer = Buffer.from(await response.arrayBuffer());

	console.log("Storing audio...");
	await fs.promises.writeFile("audio.mp3", buffer);

	return buffer;
}

async function transcribeAudio(text, buffer) {
	console.log("Transcribing...");
	const transcription = await openai.audio.transcriptions.create({
		file: await toFile(buffer, "audio.mp3"),
		model: "whisper-1",
		response_format: "verbose_json",
		timestamp_granularities: ["word", "segment"],
		prompt: `This audio file contains the spoken version of this text: "${text}"`,
	});

	return transcription;
}

const formatterTime = new Intl.DateTimeFormat("de", {
	timeZone: "Europe/Berlin",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	fractionalSecondDigits: 3,
});

const secondsToSRT = (seconds) =>
	formatterTime.format(
		new Date(
			1970,
			0,
			1,
			0,
			0,
			Math.floor(seconds),
			Math.round((seconds % 1) * 1000)
		)
	);

function chunkSentence(sentence, words) {
	// console.log(
	// 	"chunkSentence:",
	// 	sentence,
	// 	words.map((word) => word.word)
	// );

	const chunks = [];

	let chunkStartIndex = 0;
	let chunkEndIndex = chunkStartIndex;
	let chunkStartTime = words[0].start;
	let chunkEndTime = chunkStartTime;

	let i;
	for (i = 0; i < words.length; i++) {
		const { word, start, end } = words[i];
		// console.log("word:", word);

		const index = sentence.indexOf(word, chunkEndIndex);
		// console.log("index:", index);
		if (index < 0) break;

		if (index + word.length - chunkStartIndex > 30) {
			// time for new chunk
			chunks.push({
				text: sentence.slice(chunkStartIndex, chunkEndIndex),
				start: chunkStartTime,
				end: chunkEndTime,
			});
			chunkStartIndex = chunkEndIndex = index;
			chunkStartTime = start;
			chunkEndTime = end;
		} else {
			chunkEndIndex = index + word.length;
			chunkEndTime = end;
		}
	}

	if (chunkEndTime - chunkStartTime < 0.5) {
		chunks[chunks.length - 1].text += " " + sentence.slice(chunkStartIndex);
	} else {
		chunks.push({
			text: sentence.slice(chunkStartIndex),
			start: chunkStartTime,
			end: chunkEndTime,
		});
	}

	return {
		chunks,
		remainingWords: words.slice(i),
	};
}

function chunkText(text, words) {
	const sentences = text
		.split(/\s*[.!?]\s*/)
		.filter((sentence) => sentence.trim() !== "");

	console.log("Sentences:", sentences);

	return sentences.reduce(
		(result, sentence) => {
			const { chunks, remainingWords } = chunkSentence(
				sentence,
				result.remainingWords
			);
			result.chunks.push(...chunks);
			return { chunks: result.chunks, remainingWords };
		},
		{ chunks: [], remainingWords: words }
	);
}

async function generateSubtitleFile({ text, words }) {
	const { chunks } = chunkText(text, words);
	// console.log("Chunks:", chunks);

	const content = chunks
		.map(({ text, start, end }, index) => {
			return `${index + 1}\n${secondsToSRT(start)} --> ${secondsToSRT(
				end
			)}\n${text}`;
		})
		.join("\n\n");

	await fs.promises.writeFile("subtitles.srt", content);
}

const FFMPEG_PATH = resolve("../ffmpeg/bin/ffmpeg.exe");

const mergeAudio = (musicIndex) =>
	new Promise((resolve, reject) => {
		console.log(
			`Merging audio with background music (index: ${musicIndex})...`
		);

		exec(
			`${FFMPEG_PATH} -i music/00${musicIndex}.mp3 -i audio.mp3 -filter_complex "[0]volume=0.2[a0];[1]volume=3[a1];[a0][a1]amerge=inputs=2" -y final-audio.mp3`,
			(error, stdout, stderr) => {
				if (error) return reject(error);
				console.log("stdout:", stdout);
				console.log("stderr:", stderr);
				resolve();
			}
		);
	});

const createVideo = (duration, videoIndex) =>
	new Promise((resolve, reject) => {
		console.log(
			`Creating final video (duration ${duration}, index: ${videoIndex})...`
		);

		exec(
			`${FFMPEG_PATH} -y -stream_loop -1 -t ${Math.round(
				duration
			)} -i videos/video_00${videoIndex}.mp4 -i final-audio.mp3 -map 0:v -map 1:a -vf "crop=1080:1920, subtitles=subtitles.srt:force_style='Fontname=Futura,PrimaryColour=&HF0FFF0,BackColour=&H303030,Alignment=10,Bold=-1,Fontsize=22,BorderStyle=1,Outline=2,Shadow=1':fontsdir=fonts" -y output.mp4`,
			(error, stdout, stderr) => {
				if (error) return reject(error);
				console.log("stdout:", stdout);
				console.log("stderr:", stderr);
				resolve();
			}
		);
	});

(async () => {
	const { title, facts, anecdote } = await generateText();
	console.log("Title:", title);
	console.log("Facts:", facts);
	console.log("Anecdote:", anecdote);

	const text = title + "\n\n" + facts.join("\n\n");

	const buffer = await generateAudio(text);
	const transcription = await transcribeAudio(text, buffer);
	console.log("Transcript:", transcription.text);

	await fs.promises.writeFile(
		"transcript.json",
		JSON.stringify(transcription, 0, 2)
	);

	const transcriptionLoaded = JSON.parse(
		await fs.promises.readFile("transcript.json", "utf8")
	);

	await generateSubtitleFile(transcriptionLoaded);

	const musicIndex = Math.floor(Math.random() * 4) + 1;
	await mergeAudio(musicIndex);

	const videoIndex = Math.floor(Math.random() * 6) + 1;
	await createVideo(transcriptionLoaded.duration, videoIndex);
})().catch(console.error);
