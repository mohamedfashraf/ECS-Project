const UserModel = require("../Models/usersModelSchema");
const jwt = require("jsonwebtoken");
const agentModel = require("../Models/supportAgentModelSchema");
const validator = require("validator");
const mongoose = require("mongoose");
const secretKey = "s1234rf,.lp";

const otplib = require("otplib");
const { authenticator } = otplib;
const bcrypt = require("bcrypt");
const qrcode = require("qrcode");

require("dotenv").config();

async function adminRegister(req, res) {
  try {
    const { name, email, role, password, expertise } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = req.user.role;
    const newId = new mongoose.Types.ObjectId();

    if (role == "agent") {
      const agent = new agentModel({
        _id: newId,
        name,
        email,
        role,
        password: hashedPassword,
        expertise,
      });
      await agent.save();
      const user = new UserModel({
        _id: newId,
        name,
        role,
        email,
        password: hashedPassword,
      });

      await user.save();

      const agentResponse = agent.toObject();
      delete agentResponse.password;
      const userResponse = user.toObject();
      delete userResponse.password;
      res.status(201).send(agentResponse);
    } else {
      const user = new UserModel({
        name,
        role,
        email,
        password: hashedPassword,
      });
      await user.save();

      const userResponse = user.toObject();
      delete userResponse.password;
      res.status(201).send(userResponse);
    }
  } catch (error) {
    res.status(400).send(error.message);
  }
}

async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    let userTest = await UserModel.findOne({ email });
    if (userTest) {
      return res.status(400).json({ message: "email already exists.." });
    }
    const role = "user";
    const hashedPassword = await bcrypt.hash(password, 10);

    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Must be valid email.." });
    }

    if (!validator.isStrongPassword(password)) {
      return res.status(400).json({ message: "Must be strong password.." });
      // a strong password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number and one special character
    }

    const user = new UserModel({ name, role, email, password: hashedPassword });
    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).send(userResponse);
  } catch (error) {
    res.status(400).send(error.message);
  }
}

async function login(req, res) {
  try {
    const { email, password, userEnteredToken } = req.body;
    const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Email not found" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    // Check if MFA is enabled for the user
    if (user.twoFactorAuthEnabled) {
      if (!userEnteredToken) {
        return res.status(400).json({ message: "MFA token is required" });
      }
      
      const isValidToken = authenticator.verify({
        secret: user.twoFactorAuthSecret,
        token: userEnteredToken,
      });

      if (!isValidToken) {
        return res.status(401).json({ message: "Invalid MFA token" });
      }
    }

    // Create a token
    const token = jwt.sign(
      { userId: user._id, role: user.role, name: user.name, email: user.email },
      secretKey,
      { expiresIn: "2.5h" } // Token expires in 2.5 hours
    );

    // Calculate expiration time for the cookie
    const currentDateTime = new Date();
    const expiresAt = new Date(currentDateTime.getTime() + 9e6); // 9e6 milliseconds = 2.5 hours

    // Set token in a cookie
    res.cookie("token", token, {
      expires: expiresAt,
      httpOnly: false, // Consider setting to true for security
      sameSite: "None", // Adjust based on your requirements
      secure: false, // Set to true if using HTTPS
    });

    // Include the token in the JSON response
    return res.status(200).json({
      message: "Login successfully",
      user,
      token, // Send the token here
    });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

async function isValid2FA(user, token) {
  if (user.twoFactorAuthEnabled) {
    const isValid = authenticator.verify({
      secret: user.twoFactorAuthSecret,
      token,
    });

    return isValid;
  }

  return true; // 2FA is not enabled, no need to validate
}

async function getAllUsers(req, res) {
  try {
    const users = await UserModel.find({});
    res.status(200).send(users);
  } catch (error) {
    res.status(500).send(error.message);
  }
}

async function getUserById(req, res) {
  try {
    const user = await UserModel.findById(req.params.id);
    if (!user) {
      return res.status(404).send();
    }
    res.status(200).send(user);
  } catch (error) {
    res.status(500).send(error.message);
  }
}

async function updateUser(req, res) {
  try {
    const updates = Object.keys(req.body);
    const user = await UserModel.findById(req.params.id);
    if (!user) {
      return res.status(404).send();
    }
    updates.forEach((update) => (user[update] = req.body[update]));
    await user.save();
    res.status(200).send(user);
  } catch (error) {
    res.status(400).send(error.message);
  }
}

// Update user by ID
async function updateById(req, res) {
  try {
    const userId = req.params.id;
    const updates = req.body;

    // Find the user by ID
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user fields
    Object.keys(updates).forEach((key) => {
      user[key] = updates[key];
    });

    // Save the updated user
    const updatedUser = await user.save();

    // Respond with the updated user
    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

async function deleteUser(req, res) {
  try {
    const user = await UserModel.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).send();
    }
    res.status(200).send(user);
  } catch (error) {
    res.status(500).send(error.message);
  }
}

async function enable2FA(req, res) {
  try {
    // Extract token from cookies
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res
        .status(401)
        .json({ message: "Access denied. No authorization header provided." });
    }

    // Typically, the Authorization header is in the format: "Bearer [token]"
    const token = authHeader.split(" ")[1]; // Splitting by space and taking the second part (the token itself)
    if (!token) {
      return res
        .status(401)
        .json({ message: "Access denied. No token provided." });
    }

    // Verify token and extract user ID
    let userId;
    try {
      const decoded = jwt.verify(token, secretKey);
      userId = decoded.userId;
    } catch (error) {
      return res.status(403).json({ message: "Invalid token" });
    }

    // Find user by ID
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a new 2FA secret for the user
    const secret = authenticator.generateSecret();
    const otpauthURL = authenticator.keyuri(user.email, "ECS-MFA", secret);

    // Generate QR code for the OTP auth URL
    const qrCodeURL = await generateQRCode(otpauthURL);

    // Update the user with the 2FA secret and mark it as enabled
    user.twoFactorAuthSecret = secret;
    await user.save();

    res.status(200).json({ otpauthURL, qrCodeURL });
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

async function generateQRCode(data) {
  try {
    return await qrcode.toDataURL(data);
  } catch (error) {
    throw new Error("Error generating QR code");
  }
}

const verifyTwoFactorAuth = async (req, res) => {
  try {
    // Check if the Authorization header is present
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res
        .status(401)
        .json({ message: "No authorization header provided" });
    }

    // Decode the JWT token to get the user ID
    const token = authHeader.split(" ")[1]; // Assuming token format is "Bearer [token]"
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, secretKey);
    const userId = decoded.userId;

    // Extract 2FA token from the request body
    const { twoFactorAuthToken } = req.body;

    // Find the user by ID
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify the 2FA token
    const isTokenValid = authenticator.verify({
      token: twoFactorAuthToken,
      secret: user.twoFactorAuthSecret,
    });

    if (!isTokenValid) {
      return res.status(400).json({ message: "Invalid 2FA token" });
    }

    // If token is valid, enable 2FA for the user
    user.twoFactorAuthEnabled = true;
    await user.save();

    // Token is valid, proceed with the intended action
    res.status(200).json({ message: "2FA token verified successfully" });
  } catch (error) {
    console.error("Error verifying 2FA token:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

async function check2FAStatus(req, res) {
  try {
    // Extract and verify token, similar to the enable2FA function
    const authHeader = req.headers.authorization;
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, secretKey);
    const userId = decoded.userId;

    // Find user by ID
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the status of 2FA for the user
    res.status(200).json({ is2FAEnabled: user.twoFactorAuthEnabled });
  } catch (error) {
    console.error("Error checking 2FA status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

async function disableMFA(req, res) {
  try {
    // Verify the JWT token and extract user ID
    const token = req.headers.authorization.split(" ")[1];
    const decoded = jwt.verify(token, secretKey); // Use your JWT secret key
    const userId = decoded.userId;

    // Find the user in the database
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Check if MFA is already disabled
    if (!user.twoFactorAuthEnabled) {
      return res.status(400).json({ message: "MFA is already disabled." });
    }

    // Update the user's record to disable MFA
    user.twoFactorAuthEnabled = false;
    user.twoFactorAuthSecret = ""; // Clear any 2FA secret if stored
    await user.save();

    res.status(200).json({ message: "MFA disabled successfully." });
  } catch (error) {
    console.error("Error disabling MFA:", error);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
}

// async function updateMFAStatus(req, res) {
//   try {
//     const userId = await UserModel.findById(req.params._id);
//     const { mfaEnabled } = req.body;

//     const user = await UserModel.findById(userId);
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     user.mfaEnabled = mfaEnabled;
//     await user.save();

//     res.status(200).json({ message: "MFA status updated successfully" });
//   } catch (error) {
//     console.error("Error updating MFA status:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// }
module.exports = enable2FA;

module.exports = {
  register,
  login,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  adminRegister,
  enable2FA,
  verifyTwoFactorAuth,
  check2FAStatus,
  updateById,
  disableMFA,
  //updateMFAStatus
};
