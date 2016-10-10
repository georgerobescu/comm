<?php

require_once('config.php');
require_once('auth.php');

header("Content-Type: application/json");

if ($https && !isset($_SERVER['HTTPS'])) {
  // We're using mod_rewrite .htaccess for HTTPS redirect; this shouldn't happen
  header($_SERVER['SERVER_PROTOCOL'] . ' 500 Internal Server Error', true, 500);
  exit;
}

if (!user_logged_in()) {
  exit(json_encode(array(
    'error' => 'not_logged_in',
  )));
}
if (
  !isset($_POST['name']) ||
  !isset($_POST['squad']) ||
  !isset($_POST['type']) ||
  !isset($_POST['personal_password'])
) {
  exit(json_encode(array(
    'error' => 'invalid_parameters',
  )));
}

$is_closed = $_POST['type'] === 'closed';
$new_password = null;
if ($is_closed) {
  if (!isset($_POST['new_password'])) {
    exit(json_encode(array(
      'error' => 'invalid_parameters',
    )));
  }
  $new_password = $_POST['new_password'];
}

$user = get_viewer_id();
$squad = (int)$_POST['squad'];
$personal_password = $_POST['personal_password'];

// Three unrelated purposes for this query, all from different tables:
// - get hash and salt for viewer password check (users table)
// - figures out if the squad requires auth (squads table)
// - makes sure that viewer has the necessary permissions (roles table)
$result = $conn->query(
  "SELECT sq.hash IS NOT NULL as squad_requires_auth, ".
    "LOWER(HEX(u.salt)) AS salt, LOWER(HEX(u.hash)) AS hash ".
    "FROM roles su ".
    "LEFT JOIN users u ON su.user = u.id ".
    "LEFT JOIN squads sq ON su.squad = sq.id ".
    "WHERE su.squad = $squad AND su.user = $user ".
    "AND su.role >= ".ROLE_CREATOR
);
$row = $result->fetch_assoc();
if (!$row) {
  exit(json_encode(array(
    'error' => 'internal_error',
  )));
}
$hash = hash('sha512', $personal_password.$row['salt']);
if ($row['hash'] !== $hash) {
  exit(json_encode(array(
    'error' => 'invalid_credentials',
  )));
}

// If the squad is currently open but is being switched to closed,
// then a password *must* be specified
if (!$row['squad_requires_auth'] && $is_closed && trim($new_password) === '') {
  exit(json_encode(array(
    'error' => 'empty_password',
  )));
}

$name = $conn->real_escape_string($_POST['name']);
$result = $conn->query("SELECT id FROM squads WHERE name = '$name'");
$squad_row = $result->fetch_assoc();
if ($squad_row && (int)$squad_row['id'] !== $squad) {
  exit(json_encode(array(
    'error' => 'name_taken',
  )));
}

$edit_rules = $is_closed ? 1 : 0; // temporary hack
if ($is_closed && $new_password !== '') {
  $salt = md5(openssl_random_pseudo_bytes(32));
  $hash = hash('sha512', $new_password.$salt);
  $conn->query(
    "UPDATE squads SET name = '$name', ".
      "salt = UNHEX('$salt'), hash = UNHEX('$hash'), edit_rules = $edit_rules ".
      "WHERE id = $squad"
  );
} else if ($is_closed) {
  // We are guaranteed that the squad was closed beforehand, as otherwise
  // $new_password would have to be set and the above condition would've tripped
  $conn->query(
    "UPDATE squads SET name = '$name' WHERE id = $squad"
  );
} else {
  $conn->query(
    "UPDATE squads SET name = '$name', ".
      "salt = NULL, hash = NULL, edit_rules = $edit_rules ".
      "WHERE id = $squad"
  );
}

exit(json_encode(array(
  'success' => true,
)));
