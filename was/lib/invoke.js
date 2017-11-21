/**
 * 목적:
 * 체인코드 Invoke 기능을 수행한다. 
 *
 * @author 최의신 (choies@kr.ibm.com)
 *
 */
var hfc = require('fabric-client');
var path = require('path');
var util = require('util');

var appConfig;
var options;
var channel = {};
var client = null;
var targets = [];

/**
 * 채널 사용을 위한 준비를 한다.
 * 
 */
exports.prepare = function(config)
{
    appConfig = config;

    options = {
        wallet_path: path.join(__dirname, '../creds'),
        user_id: config.invokePeer.userId,
        channel_id: config.invokePeer.channelId,
        chaincode_id: config.invokePeer.chaincodeId,
        peer_url: config.invokePeer.peerUrl,
        event_url: config.invokePeer.eventUrl,
        orderer_url: config.invokePeer.ordererUrl
    };

    return Promise.resolve().then(() => {
        console.log("[DEBUG-INVOKE] Create a client and set the wallet location");
        client = new hfc();
        return hfc.newDefaultKeyValueStore({ path: options.wallet_path });
    }).then((wallet) => {
        console.log("[DEBUG-INVOKE] Set wallet path, and associate user ", options.user_id, " with application");
        client.setStateStore(wallet);
        return client.getUserContext(options.user_id, true);
    }).then((user) => {
        console.log("[DEBUG-INVOKE] Check user is enrolled, and set a query URL in the network");
        if (user === undefined || user.isEnrolled() === false) {
            throw new Error("User not defined, or not enrolled - error");
        }
        channel = client.newChannel(options.channel_id);
        var peerObj = client.newPeer(options.peer_url);
        channel.addPeer(peerObj);
        channel.addOrderer(client.newOrderer(options.orderer_url));
        targets.push(peerObj);

        let eh = client.newEventHub();
        eh.setPeerAddr(options.event_url, {'request-timeout': config.invokePeer.timeout});
        eh.connect();
        
        return "Ready";
    });
};

var chainEvtHub;
var evtHandle;

/**
 * 체인코드 이벤트를 등록한다.
 *
 * @param ccid 체인코드 아이디
 * @param eventName 체인코드에서 발생하는 이벤트명
 * @param cbEvent 이벤트 callback
 *                이벤트로 전달되는 object는 eventCode, payload 속성을 갖는다.
 * @param cbError 에러 callback
 *
 */
exports.registerChaincodeEvent = function(ccid, eventName, cbEvent, cbError)
{
    chainEvtHub = client.newEventHub();
    chainEvtHub.setPeerAddr(options.event_url, {'request-timeout': appConfig.invokePeer.timeout});
    chainEvtHub.connect();

    evtHandle = chainEvtHub.registerChaincodeEvent(ccid, eventName, cbEvent, cbError);
}

/*
 * 체인코드 이벤트를 해제한다.
 */
exports.unregisterChaincodeEvent = function()
{
    if ( chainEvtHub != null )
        chainEvtHub.unregisterChaincodeEvent(evtHandle);
    
    chainEvtHub.disconnect();
    chainEvtHub = null;
}

/**
 * 블록이벤트를 등록한다.
 */
exports.registerBlockEvent = function(cbEvent, cbError)
{
    chainEvtHub = client.newEventHub();
    chainEvtHub.setPeerAddr(options.event_url, {'request-timeout': appConfig.invokePeer.timeout});
    chainEvtHub.connect();

    evtHandle = chainEvtHub.registerBlockEvent(cbEvent, cbError);
}

/*
 * 블록이벤트를 해제한다.
 */
exports.unregisterBlockEvent = function()
{
    if ( chainEvtHub != null )
        chainEvtHub.unregisterBlockEvent(evtHandle);
    
    chainEvtHub.disconnect();
    chainEvtHub = null;
}


/**
 * 체인코드 Invoke를 호출한다.
 * 
 * @param parms 체인코드 호출을 위한 정보를 갖고 있는 객체. 다음의 속성을 갖는다.
 *              - funcName : 체인코드 함수명
 *              - args : 함수로 전달할 데이터 배열
 * @return 체인코드 호출 결과를 반환하며, 다음의 속성을 갖는다.
 *         - trxID : 드랜잭션 ID
 *         - payload : 체인코드에서 반환한 결과값
 */
exports.invoke = function(parms)
{
    var tx_id = null;
    var payload = null;
    
    return Promise.resolve().then(() => {
        tx_id = client.newTransactionID();
        console.log("[DEBUG-INVOKE] Assigning transaction_id: ", tx_id._transaction_id);

        var request = {
            targets: targets,
            chaincodeId: options.chaincode_id,
            fcn: parms.funcName,
            args: parms.args,
            chainId: options.channel_id,
            txId: tx_id
        };
        
        return channel.sendTransactionProposal(request);
    }).then((results) => {
        var proposalResponses = results[0];        
        var proposal = results[1];
        var header = results[2];
        let isProposalGood = false;
        if (proposalResponses && proposalResponses[0].response &&
            proposalResponses[0].response.status === 200) {
            isProposalGood = true;
            console.log('[DEBUG-INVOKE] transaction proposal was good');
        } else {
            throw new Error('transaction proposal was bad');
        }
        if (isProposalGood) {
            console.log("[DEBUG-INVOKE] " + util.format(
                'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s", metadata - "%s"',
                proposalResponses[0].response.status, proposalResponses[0].response.message,
                proposalResponses[0].response.payload));
            
            // 체인코드 리턴값
            payload = proposalResponses[0].response.payload;
            
            var request = {
                proposalResponses: proposalResponses,
                proposal: proposal,
                header: header
            };
            // set the transaction listener and set a timeout of 30sec
            // if the transaction did not get committed within the timeout period,
            // fail the test
            var transactionID = tx_id.getTransactionID();
            var eventPromises = [];
            let eh = client.newEventHub();
            eh.setPeerAddr(options.event_url, {'request-timeout': appConfig.invokePeer.timeout});
            eh.connect();
    
            let txPromise = new Promise((resolve, reject) => {
                let handle = setTimeout(() => {
                    eh.disconnect();
                    reject();
                }, appConfig.invokePeer.timeout);
    
                eh.registerTxEvent(transactionID, (tx, code) => {
                    clearTimeout(handle);
                    eh.unregisterTxEvent(transactionID);
                    eh.disconnect();
    
                    if (code !== 'VALID') {
                        console.error('[DEBUG-INVOKE] The transaction was invalid, code = ' + code);
                        reject();
                    } else {
                        console.log('[DEBUG-INVOKE] The transaction has been committed on peer ' + eh._ep._endpoint.addr);
                        resolve();
                    }
                });
            });
            eventPromises.push(txPromise);
            var sendPromise = channel.sendTransaction(request);
            return Promise.all([sendPromise].concat(eventPromises)).then((results) => {
                console.log(' event promise all complete and testing complete');
                return results[0]; // the first returned value is from the 'sendPromise' which is from the 'sendTransaction()' call
            }).catch((err) => {
                console.error(
                    'Failed to send transaction and get notifications within the timeout period.'
                );
                return 'Failed to send transaction and get notifications within the timeout period.';
            });
        } else {
            console.error(
                'Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...'
            );
            return 'Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...';
        }
    }, (err) => {
        console.error('Failed to send proposal due to error: ' + err.stack ? err.stack : err);
        return 'Failed to send proposal due to error: ' + err.stack ? err.stack : err;
    }).then((response) => {
        if (response.status === 'SUCCESS') {
            console.log('[DEBUG-INVOKE] Successfully sent transaction to the orderer.');
            return {trxID: tx_id.getTransactionID(), payload: payload};
        } else {
            console.error('Failed to order the transaction. Error code: ' + response.status);
            throw new Error('Failed to order the transaction. Error code: ' + response.status);
        }
    }, (err) => {
        console.error('Failed to send transaction due to error: ' + err.stack ? err.stack : err);
            throw new Error('Failed to send transaction due to error: ' + err.stack ? err.stack : err);
    });
};

