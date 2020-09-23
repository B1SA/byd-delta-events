// const url = 'http://checkip.amazonaws.com/';
let response;

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 * 
*/

const AWS = require("aws-sdk");
const thisRunDate = new Date()
const axios = require('axios')


if(process.env.AWS_SAM_LOCAL){
    // To use local DynamoDB
    console.log("Local environment detected")
    AWS.config.update({endpoint: "http://localhost:8000", region: "eu-central-1"});
}

const dynamo = new AWS.DynamoDB();

exports.lambdaHandler = async (event, context) => {
    try {
        // Default Response. This is an asynchronous function. 
        // caller do not wait for it to finish processing
        response = {
            'statusCode': 200,
            'body': JSON.stringify({message: 'get ByD objects Started'})
        }
        
        //Retrieve configuration from DynamoDB
        const data  = await getConfig()
        console.log("Config Loaded from DynamoDB")

        //Retrieve delta from ByD Objects
        await Promise.all([getSalesInvoices(data.lastRun.S),getCustomers(data.lastRun.S)]).then((values) => {
            console.log(values[0]);
            console.log(values[1]);
          });

    } catch (err) {
        console.error(err);
        return response

    }
    return response
};

let getConfig = function(){
    // Returns Configuration Record from DynamoDB
    return new Promise(function (resolve, reject) {
        
        const params = {
            Key: { configId: { "N": process.env.CONFIG_ID}},
            TableName: process.env.CONFIG_TABLE,
        }; 

        //Workaround while LOCAL Dynamo isn't ready
        if(process.env.AWS_SAM_LOCAL){
            var response = { Item: {
                                lastRun: { S: '2020-09-13T09:31:06.393Z'},
                                configId: { N: '0' } 
                            }}
            resolve(response.Item)
        }

        dynamo.getItem(params).promise()
        .then(function(data){
            resolve(data.Item)
        })
        .catch(function(error){
            console.error("error loading from dynamo"+ error)
            reject( new Error("Error Loading Condiguration! - " + error))
        })
    })
}

let getSalesInvoices = function(lastRun){
    // Returns Invoices from ByD
    return new Promise(function (resolve, reject){ 
        console.log("Retrieving ByD Invoices") 

        getBydObject(lastRun, process.env.BYD_INVOICES,process.env.BYD_INVOICES_ID).then((data) =>{
            console.log("INVOICES RETRIEVED")
            resolve(data)
        })

    })
}


let getCustomers = function(lastRun){
    // Returns Customers from BYD
    return new Promise(function (resolve, reject){ 
        console.log("Retrieving ByD Customers") 
        getBydObject(lastRun, process.env.BYD_CUSTOMERS,process.env.BYD_CUSTOMERS_ID).then((data) =>{
            console.log("Customers RETRIEVED")
            resolve(data)
        })
    })
}

let updateLastRun = function(lastRun){
    // Returns Configuration Record from DynamoDB
    return new Promise(function (resolve, reject){ 
        console.log("Updating Last Run on DynamoDB") 
        resolve()
    })
}

let getBydObject = function(lastRun, endpoint, idAttribute, additionalAttributes){
    return new Promise(function (resolve, reject){ 
        
        console.log("Retriving ByD Objects")
        console.log("Preparing request to "+endpoint)

        var params = new URLSearchParams({
            "$format":"json",
            "$select":idAttribute+",ObjectID,CreationDateTime,LastChangeDateTime",
            "$filter":"LastChangeDateTime ge datetimeoffset" +quotes(lastRun)
        })

        const options = {
                method: "GET",
                baseURL: process.env.BYD_ODATA,
                url: endpoint,
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + process.env.BYD_AUTH,
                    "x-csrf-token": "fetch"
                },
                params:params
        }

        console.log(options)

        axios.request(options).then((response) => {
          console.log(`ByD Response: is ${response.status} - ${response.statusText}`)
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(
              new Error(`${response.statusCode}: ${response.req.getHeader("host")} ${response.req.path}`)
            );
          }else{
            
            var  formatedData = []
            response.data.d.results.forEach(function(elem){
                element = formatData(elem,idAttribute, additionalAttributes)
                console.log(element)
                if(element){
                    formatedData.push(element)
                }
            })
            
            // console.debug(`Data ${JSON.stringify(formatedData)}`)
            return resolve(formatedData)
          }
        })
        .catch((err) => {
          console.error("Error calling ByD -" + err)
          reject(new Error(err));
        })       
    })
}

function quotes(val){
    return "%27" + val + "%27";
}

function formatData(elem,idAttribute,additionalAttributes){
    try{
        const updated = elem.CreationDateTime==elem.LastChangeDateTime?false:true //If dates are the same the item was created
        var element = elem
        element.genericId = elem[idAttribute]
        element.updated = updated
        element.genericType = elem.__metadata.type.split('.')[1]
        element.dateStr = updated?BydTimestampToHumanDate(elem.LastChangeDateTime):BydTimestampToHumanDate(elem.CreationDateTime)
        delete element['__metadata']
        return element
    }
    catch(error){
        console.error("Error formating data")
        console.error(error)
        return null

    }
}

function BydTimestampToHumanDate(bydDate){

    try{
        //DateFormat is /Date(1600183555000)/
        const timestamp = bydDate.substring(bydDate.lastIndexOf("(") + 1, bydDate.lastIndexOf(")"));
        const humanDate = new Date(timestamp*1)
        return humanDate
    }catch(error){
        console.error("Error formating date to human readable")
        console.error(error)
        return null
    }
    
}
