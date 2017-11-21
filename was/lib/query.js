/**
 * 목적:
 * 체인코드 Query 기능을 수행한다. 
 *
 * @author 최의신 (choies@kr.ibm.com)
 *
 */

var hfc = require('fabric-client');
var path = require('path');

var appConfig;
var options;
var channel = {};
var client = null;

/**
 * 
 */
exports.prepare = function(config)
{
    appConfig = config;
    
    options = {
        wallet_path: path.join(__dirname, '../creds'),
        user_id: config.queryPeer.userId,
        channel_id: config.queryPeer.channelId,
        chaincode_id: config.queryPeer.chaincodeId,
        network_url: config.queryPeer.peerUrl,
    };

    return Promise.resolve().then(() => {
        console.log("[DEBUG-QUERY] Create a client and set the wallet location");
        client = new hfc();
        return hfc.newDefaultKeyValueStore({ path: options.wallet_path });
    }).then((wallet) => {
        console.log("[DEBUG-QUERY] Set wallet path, and associate user ", options.user_id, " with application");
        client.setStateStore(wallet);
        return client.getUserContext(options.user_id, true);
    }).then((user) => {
        console.log("[DEBUG-QUERY] Check user is enrolled, and set a query URL in the network");
        if (user === undefined || user.isEnrolled() === false) {
            throw new Error("User not defined, or not enrolled - error");
        }
        channel = client.newChannel(options.channel_id);
        var peerObj = client.newPeer(options.network_url)
        channel.addPeer(peerObj);

        return "Ready";
    });
};

/**
 * 
 * @param parms
 * @param callback
 */
exports.query = function(parms)
{
    return Promise.resolve().then(() => {
        var transaction_id = client.newTransactionID();
        console.log("[DEBUG-QUERY] Assigning transaction_id: ", transaction_id._transaction_id);

        const request = {
            chaincodeId: options.chaincode_id,
            txId: transaction_id,
            fcn: parms.funcName,
            args: parms.args
        };
        return channel.queryByChaincode(request);
    }).then((query_responses) => {
        console.log("[DEBUG-QUERY] returned from query");
        if (!query_responses.length) {
            console.send("[DEBUG-QUERY] No payloads were returned from query");
        } else {
            console.log("[DEBUG-QUERY] Query result count = ", query_responses.length);
        }
        if (query_responses[0] instanceof Error) {
            throw new Error(query_responses[0]);
        }

        return query_responses[0].toString();
    });
};