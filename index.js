const express = require('express');
const path = require('path');
const Q = require('q');
const wrtc = require('wrtc');
const RTCPeerConnection = wrtc.RTCPeerConnection;
const RTCSessionDescription = wrtc.RTCSessionDescription;
const RTCIceCandidate = wrtc.RTCIceCandidate;

const app = express();

app.use(require('body-parser').json());

// serve the test page
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

var channels = {};

function makeid() {
    while (true) {
        const ID_LENGTH = 12;
        var text = "";
        var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

        for (var i = 0; i < ID_LENGTH; i++)
            text += possible.charAt(Math.floor(Math.random() * possible.length));

        // what are the chances...
        if (text in channels) continue;

        return text;
    }
}

function handleError(error) {
    res.status(500).json({ success: false, error: error });
}

app.post('/channels', (req, res) => {
    let pc1 = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    let channelId = makeid();
    let channel = channels[channelId] = {
        id: channelId,
        pc: pc1,
        status: 'WAITING_FOR_ANSWER',
    };

    var iceCandidates = [];
    var iceCandidateDeferred = Q.defer();
    var localDescription;
    var localDescriptionDeferred = Q.defer();

    pc1.onicecandidate = function(candidate) {
        if (!candidate.candidate) {
            iceCandidateDeferred.resolve();
        } else {
            var iceCandidate = {
                sdpMLineIndex: candidate.candidate.sdpMLineIndex,
                candidate: candidate.candidate.candidate
            }
            console.log(`${channelId} pc1.onicecandidate`, JSON.stringify(iceCandidate));
            iceCandidates.push(iceCandidate);
        }
    };

    function setRemoteDescription2(desc) {
        localDescription = desc;
        localDescriptionDeferred.resolve();
    }   

    function setLocalDescription1(desc) {
        console.log(`${channelId} pc1: set local description`);
        pc1.setLocalDescription(
            new RTCSessionDescription(desc),
            setRemoteDescription2.bind(null, desc),
            handleError
        );
    }

    function createOffer1() {
        console.log(`${channelId} pc1: create offer`);
        pc1.createOffer(setLocalDescription1, handleError);
    }

    let dc1 = channel.dc = pc1.createDataChannel('test');
    channel.dc.onopen = function() {
        console.log(`${channelId} pc1: data channel open`);
        channel.status = 'CHANNEL_ESTABLISHED',
        dc1.onmessage = function(event) {
            var data = event.data;
            console.log(`${channelId} dc1: received "${data}"`);
            dc1.send(`pong ${data}`);
        };
    };

    createOffer1();

    Promise.all([
        iceCandidateDeferred.promise,
        localDescriptionDeferred.promise
    ]).then(() => {
        res.status(200).json({
            success: true,
            channel_id: channelId,
            offer: localDescription,
            ice_candidates: iceCandidates,
        })
    });
});

function channelCheck(req, res) {
    let channelId = req.params.channelId;
    if (!(channelId in channels)) {
        res.status(404).json({
            success: false,
            reason: 'channel not found'
        });
        return null;
    }
    return channels[channelId];
}

app.post('/channels/:channelId/answer', (req, res) => {
    let channel = channelCheck(req, res);
    if (!channel) return;

    if (channel.status !== 'WAITING_FOR_ANSWER') {
        res.status(400).json({
            success: false,
            reason: 'channel is not waiting for answer'
        });
    }

    function setRemoteDescription1(desc) {
        console.log(`${channel.id} pc1: set remote description`);
        channel.status = 'ANSWERED',
        channel.pc.setRemoteDescription(
            new RTCSessionDescription(desc),
            () => {
                res.status(200).json({
                    success: true
                })
            },
            handleError
        );
    }

    // ignore remote ice candidates
    function addIceCandidates(iceCandidates) {
        for (let i in iceCandidates) {
            let iceCandidate = iceCandidates[i].candidate;
            console.log(`${channel.id} pc1: adding ice candidate`, JSON.stringify(iceCandidate));
        }
    }

    setRemoteDescription1(req.body.answer);
    addIceCandidates(req.body.ice_candidates);
});

app.post('/channels/:channelId/close', (req, res) => {
    let channel = channelCheck(req, res);
    if (!channel) return;
    console.log(`${channel.id} pc1: close`);
    channel.pc.close();
    delete channels[channel.id];
    return res.status(200).send({
        success: true
    });
});

app.listen(3000, () => console.log('Example app listening on port 3000!'))
