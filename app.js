import express from "express";
import OAuthClient from "intuit-oauth";
import { Client, Environment } from "square";
import cors from "cors";
import helmet from "helmet";
import * as mongodb from "mongodb";
import { S3Client, ListObjectsCommand } from "@aws-sdk/client-s3";

const MongoClient = mongodb.MongoClient;

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const app = express();

let qbToken = null;
let oauthClient = null;

const url = process.env.DB_URL;

async function addHandledPurchase(ids) {
  const mongoClient = new MongoClient(url, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
  });
  await mongoClient.connect();
  const db = mongoClient.db("canna-kool");
  const collection = db.collection("handled-purchases");
  const docs = [];
  ids.forEach((it) => {
    docs.push({ purchaseId: it });
  });
  const result = await collection.insertMany(docs);
  await mongoClient.close();
  return await result;
}
async function getHandledPurchases() {
  const mongoClient = new MongoClient(url, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
  });
  await mongoClient.connect();
  const db = mongoClient.db("canna-kool");
  const collection = db.collection("handled-purchases");
  const cursor = await collection.find({});
  let handledPurchases = [];
  await cursor.forEach((it) => {
    handledPurchases.push(it.purchaseId);
  });
  await mongoClient.close();
  return await handledPurchases;
}

var corsOptions = {
  origin: "https://canna-kool-admin-client.netlify.app",
  exposedHeaders: ["X-Total-Count"],
};

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(helmet());
app.use(cors(corsOptions));

app.get("/api/isauth", (req, res) => {
  res.json({ isAuth: qbToken != null });
});

app.get("/api/qbauth", (req, res) => {
  oauthClient = new OAuthClient({
    clientId: process.env.QB_CLIENTID,
    clientSecret: process.env.QB_SECRET,
    environment: "sandbox",
    redirectUri: process.env.QB_REDIRECT,
  });
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: "intuit-test",
  });
  res.status(200).json({ url: authUri });
});
app.get("/api/handleQBCallback", (req, res) => {
  oauthClient
    .createToken(req.url)
    .then(function (authResponse) {
      qbToken = JSON.stringify(authResponse.getJson(), null, 2);
    })
    .catch(function (e) {
      console.error(e);
    });
  res.redirect(301, process.env.CLIENT_URL);
});

function getShippingAddressOrNone(shippingAddress) {
  let line1 = shippingAddress.addressLine1;
  let line2 = shippingAddress.addressLine2;
  let city = shippingAddress.locality;
  let state = shippingAddress.administrativeDistrictLevel1 || "CA";
  let zip = shippingAddress.postalCode;
  return [line1, line2, city, state, zip].filter(Boolean).join(" ");
}

app.get("/api/purchases", async (req, res) => {
  const squareClient = new Client({
    environment: Environment.Sandbox,
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
  });

  const paymentsApi = squareClient.paymentsApi;
  let { result } = await paymentsApi.listPayments();
  let finalResult = [];
  let handledPurchases = await getHandledPurchases();
  result.payments.forEach((it) => {
    if (!handledPurchases.includes(it.id) && it.shippingAddress) {
      finalResult.push({
        id: it.id,
        date: it.createdAt,
        Price: Number(it.amountMoney.amount) / 100,
        Address: getShippingAddressOrNone(it.shippingAddress),
      });
    }
  });
  let total = finalResult.length;
  res.setHeader("X-Total-Count", total);
  res.json(finalResult);
});
app.get("/api/labresults", async (req, res) => {
  // Set the AWS Region
  const REGION = "us-east-1"; //e.g. "us-east-1"

  // Create the parameters for the bucket
  const bucketParams = { Bucket: "canna-kool-lab-results" };

  // Create S3 service object
  const s3 = new S3Client({ region: REGION });

  async function run() {
    // Declare truncated as a flag that we will base our while loop on
    let truncated = true;
    // Declare a variable that we will assign the key of the last element in the response to
    let pageMarker;
    // While loop that runs until response.truncated is false
    while (truncated) {
      try {
        const response = await s3.send(new ListObjectsCommand(bucketParams));
        response.Contents.forEach((item) => {
          console.log(item.Key);
        });
        // Log the Key of every item in the response to standard output
        truncated = response.IsTruncated;
        // If 'truncated' is true, assign the key of the final element in the response to our variable 'pageMarker'
        if (truncated) {
          pageMarker = response.Contents.slice(-1)[0].Key;
          // Assign value of pageMarker to bucketParams so that the next iteration will start from the new pageMarker.
          bucketParams.Marker = pageMarker;
        }
        // At end of the list, response.truncated is false and our function exits the while loop.
      } catch (err) {
        console.log("Error", err);
        truncated = false;
      }
    }
  }
  res.send(response.Contents);
});

app.post("/api/createitem", async (req, res) => {
  console.log("CREATE: " + JSON.stringify(req.body));
  oauthClient
    .makeApiCall({
      url:
        "https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365163933140/purchase",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    })
    .then(function (response) {
      console.log("The API response is  : " + response);
      res.status(200).send(" ");
    })
    .catch(function (e) {
      console.log(e);
      res.status(400);
    });
});

app.listen(process.env.PORT, () =>
  console.log(
    `Server is listening on port ${process.env.PORT} with DB url at ${url}`
  )
);
