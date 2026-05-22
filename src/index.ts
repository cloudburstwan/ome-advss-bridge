import express from "express";
import mqtt from "mqtt";
import { createHmac } from "crypto";

const mqttClient = mqtt.connect(`mqtt://${process.env.MQTT_DOMAIN}:1883`, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
});

let activeStreamKeys: string[] = [];

const app = express();
app.use(express.json());

app.post("/api/create-signed-policy", async (req, res) => {
    if (req.get("Authorization") == undefined) return res.status(401).json({ code: "REQUIRES_AUTH", message: "" })
    if (req.get("Authorization") != `Bearer ${process.env.API_KEY}`) return res.status(401).send("Unauthorized");

    const data = req.body as SignedPolicyCreatorRequest;
    let policy = {
        url_activate: new Date(data.startAt).getTime() - data.bufferLengthMs,
        url_expire: new Date(data.endAt).getTime() + data.bufferLengthMs,
        stream_expire: new Date(data.endAt).getTime() + data.bufferLengthMs,
    }
    let policyB64url = Buffer.from(JSON.stringify(policy)).toString("base64url");

    let rtmpUrl = `rtmp://${process.env.OME_DOMAIN}:1935/app/${data.key}?policy=${policyB64url}`;
    let srtUrl = `srt://${process.env.OME_DOMAIN}:9999/app/${data.key}?policy=${policyB64url}`;

    let rtmpSignature = createHmac("sha1", process.env.OME_SIGNED_POLICY_SIGNATURE_KEY as string)
        .update(rtmpUrl)
        .digest('base64url');
    let srtSignature = createHmac("sha1", process.env.OME_SIGNED_POLICY_SIGNATURE_KEY as string)
        .update(srtUrl)
        .digest('base64url');

    res.status(200).json({
        rtmp: `${rtmpUrl}&signature=${rtmpSignature}`,
        srt: `srt://${process.env.OME_DOMAIN}:9999?streamid=${encodeURIComponent(`${srtUrl}&signature=${srtSignature}`)}`,
    });
});

app.post("/webhooks/admission", async (req, res) => {
    let hmacVerificationSignature = createHmac("sha1", process.env.OME_WEBHOOK_SIGNATURE_KEY as string)
        .update(JSON.stringify(req.body))
        .digest('base64url');

    if (hmacVerificationSignature != req.get("X-Ome-Signature")) {
        res.json({
            allowed: false,
            reason: "HMAC_VERIFICATION_FAILED: Failed to verify HMAC signature, request is denied",
        });
        return;
    }

    let data = req.body as AdmissionWebhookRequest;
    let urlInfo = /(.+):\/\/(.+)\/app\/(.+)/g.exec(data.request.url);
    let key = urlInfo![3].split("?")[0];

    if (data.request.status == "opening") {
        activeStreamKeys.push(key);
    } else {
        if (!activeStreamKeys.includes(key)) {
            res.json({
                allowed: false,
                reason: "STREAM_NOT_FOUND: Stream not found",
            });
            return;
        }
        activeStreamKeys = activeStreamKeys.filter(k => k != key);
    }

    mqttClient.publish("/ome-stream-status", `${data.request.status == "opening" ? "UP" : "DOWN"}:${key}`);

    res.json({
        allowed: true
    });
});

app.listen(80);

interface SignedPolicyCreatorRequest {
    key: string;
    startAt: string;
    endAt: string;
    bufferLengthMs: number;
}

interface AdmissionWebhookRequest {
    client: {
        address: string;
        port: number;
        real_ip: string;
        user_agent: string;
    };
    request: {
        direction: "incoming" | "outgoing";
        protocol: "webrtc" | "rtmp" | "srt" | "llhls" | "thumbnail",
        status: "opening" | "closing";
        url: string;
        new_url: string;
        time: string;
    }
}