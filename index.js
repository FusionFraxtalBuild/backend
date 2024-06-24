const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config({ path: "./.env" });
const PORT = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API Running");
});

app.use("/api/deploy", require("./routes/api/deploy"));
app.use("/api/execute", require("./routes/api/execute"));
app.use("/api/executeBatch", require("./routes/api/executeBatch"));
app.use("/api/recovery", require("./routes/api/recovery"));
app.use("/api/change", require("./routes/api/change"));
app.use("/api/public-conversion", require("./routes/api/public-conversion"));
app.use("/api/transactions", require("./routes/api/transactions"));
app.use("/api/gasCredit", require("./routes/api/gasCredit"));

app.post("/", (req, res) => {
  const body = req.body;

  console.log("body", body);

  const array = body.params[0].Array;
  console.log("array", array);
  return res.status(200).json({
    id: body.id,
    result: { values: [{ Array: array }] },
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
