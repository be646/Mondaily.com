import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";

const router = express.Router();
const passwordSaltRounds = 12;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function signSessionToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET environment variable.");
  }

  return jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
      issuer: "mondaily-api"
    }
  );
}

router.post("/signup", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "Valid email is required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ ok: false, message: "Password must be at least 8 characters." });
    }

    const { data: existingUser, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ ok: false, message: "Could not check existing user.", error: lookupError.message });
    }

    if (existingUser) {
      return res.status(409).json({ ok: false, message: "Email is already registered." });
    }

    const passwordHash = await bcrypt.hash(password, passwordSaltRounds);

    const { data: user, error: userError } = await supabase
      .from("users")
      .insert({
        email,
        password_hash: passwordHash
      })
      .select("id, email, created_at, last_login")
      .single();

    if (userError) {
      return res.status(500).json({ ok: false, message: "Could not create user.", error: userError.message });
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({
        user_id: user.id,
        application_data: {},
        saved_state: {}
      })
      .select("id, user_id, application_data, saved_state, updated_at")
      .single();

    if (workspaceError) {
      await supabase.from("users").delete().eq("id", user.id);
      return res.status(500).json({ ok: false, message: "Could not create workspace.", error: workspaceError.message });
    }

    const token = signSessionToken(user);

    return res.status(201).json({
      ok: true,
      token,
      user,
      workspace
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Signup failed.", error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "Email and password are required." });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, password_hash, created_at, last_login")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ ok: false, message: "Could not find user.", error: userError.message });
    }

    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ ok: false, message: "Invalid email or password." });
    }

    const lastLogin = new Date().toISOString();
    await supabase
      .from("users")
      .update({ last_login: lastLogin })
      .eq("id", user.id);

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, user_id, application_data, saved_state, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (workspaceError) {
      return res.status(500).json({ ok: false, message: "Could not load workspace.", error: workspaceError.message });
    }

    const token = signSessionToken(user);
    const safeUser = {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_login: lastLogin
    };

    return res.json({
      ok: true,
      token,
      user: safeUser,
      workspace
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Login failed.", error: error.message });
  }
});

export default router;
