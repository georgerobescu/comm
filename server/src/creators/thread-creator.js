// @flow

import invariant from 'invariant';

import bots from 'lib/facts/bots';
import { relationshipBlockedInEitherDirection } from 'lib/shared/relationship-utils';
import {
  generatePendingThreadColor,
  generateRandomColor,
} from 'lib/shared/thread-utils';
import { hasMinCodeVersion } from 'lib/shared/version-utils';
import type { Shape } from 'lib/types/core';
import { messageTypes } from 'lib/types/message-types';
import { userRelationshipStatus } from 'lib/types/relationship-types';
import {
  type NewThreadRequest,
  type NewThreadResponse,
  threadTypes,
  threadPermissions,
} from 'lib/types/thread-types';
import { ServerError } from 'lib/utils/errors';
import { promiseAll } from 'lib/utils/promises';

import { dbQuery, SQL } from '../database/database';
import { fetchMessageInfoByID } from '../fetchers/message-fetchers';
import { fetchThreadInfos } from '../fetchers/thread-fetchers';
import { checkThreadPermission } from '../fetchers/thread-permission-fetchers';
import { fetchKnownUserInfos } from '../fetchers/user-fetchers';
import type { Viewer } from '../session/viewer';
import {
  changeRole,
  recalculateAllPermissions,
  commitMembershipChangeset,
  setJoinsToUnread,
  getRelationshipRowsForUsers,
  getParentThreadRelationshipRowsForNewUsers,
} from '../updaters/thread-permission-updaters';
import createIDs from './id-creator';
import createMessages from './message-creator';
import { createInitialRolesForNewThread } from './role-creator';
import type { UpdatesForCurrentSession } from './update-creator';

const { squadbot } = bots;

const privateThreadDescription =
  'This is your private thread, ' +
  'where you can set reminders and jot notes in private!';

type CreateThreadOptions = Shape<{|
  +forceAddMembers: boolean,
  +updatesForCurrentSession: UpdatesForCurrentSession,
  +silentlyFailMembers: boolean,
|}>;

// If forceAddMembers is set, we will allow the viewer to add random users who
// they aren't friends with. We will only fail if the viewer is trying to add
// somebody who they have blocked or has blocked them. On the other hand, if
// forceAddMembers is not set, we will fail if the viewer tries to add somebody
// who they aren't friends with and doesn't have a membership row with a
// nonnegative role for the parent thread.
async function createThread(
  viewer: Viewer,
  request: NewThreadRequest,
  options?: CreateThreadOptions,
): Promise<NewThreadResponse> {
  if (!viewer.loggedIn) {
    throw new ServerError('not_logged_in');
  }

  const forceAddMembers = options?.forceAddMembers ?? false;
  const updatesForCurrentSession =
    options?.updatesForCurrentSession ?? 'return';
  const silentlyFailMembers = options?.silentlyFailMembers ?? false;

  const threadType = request.type;
  const shouldCreateRelationships =
    forceAddMembers || threadType === threadTypes.PERSONAL;
  const parentThreadID = request.parentThreadID ? request.parentThreadID : null;
  const initialMemberIDsFromRequest =
    request.initialMemberIDs && request.initialMemberIDs.length > 0
      ? request.initialMemberIDs
      : null;
  const ghostMemberIDs =
    request.ghostMemberIDs && request.ghostMemberIDs.length > 0
      ? request.ghostMemberIDs
      : null;

  const sourceMessageID = request.sourceMessageID
    ? request.sourceMessageID
    : null;
  invariant(
    threadType !== threadTypes.SIDEBAR || sourceMessageID,
    'sourceMessageID should be set for sidebar',
  );

  if (
    threadType !== threadTypes.CHAT_SECRET &&
    threadType !== threadTypes.PERSONAL &&
    threadType !== threadTypes.PRIVATE &&
    !parentThreadID
  ) {
    throw new ServerError('invalid_parameters');
  }

  if (
    threadType === threadTypes.PERSONAL &&
    (request.initialMemberIDs?.length !== 1 || parentThreadID)
  ) {
    throw new ServerError('invalid_parameters');
  }

  const checkPromises = {};
  if (parentThreadID) {
    checkPromises.parentThreadFetch = fetchThreadInfos(
      viewer,
      SQL`t.id = ${parentThreadID}`,
    );
    checkPromises.hasParentPermission = checkThreadPermission(
      viewer,
      parentThreadID,
      threadType === threadTypes.SIDEBAR
        ? threadPermissions.CREATE_SIDEBARS
        : threadPermissions.CREATE_SUBTHREADS,
    );
  }

  const memberIDs = [];
  if (initialMemberIDsFromRequest) {
    memberIDs.push(...initialMemberIDsFromRequest);
  }
  if (ghostMemberIDs) {
    memberIDs.push(...ghostMemberIDs);
  }

  if (initialMemberIDsFromRequest || ghostMemberIDs) {
    checkPromises.fetchMemberIDs = fetchKnownUserInfos(viewer, memberIDs);
  }

  if (sourceMessageID) {
    checkPromises.sourceMessage = fetchMessageInfoByID(viewer, sourceMessageID);
  }

  const {
    parentThreadFetch,
    hasParentPermission,
    fetchMemberIDs,
    sourceMessage,
  } = await promiseAll(checkPromises);

  let parentThreadMembers;
  if (parentThreadID) {
    invariant(parentThreadFetch, 'parentThreadFetch should be set');
    const parentThreadInfo = parentThreadFetch.threadInfos[parentThreadID];
    if (!hasParentPermission) {
      throw new ServerError('invalid_credentials');
    }
    parentThreadMembers = parentThreadInfo.members.map(
      (userInfo) => userInfo.id,
    );
  }

  const viewerNeedsRelationshipsWith = [];
  const silencedMemberIDs = new Set();
  if (fetchMemberIDs) {
    invariant(initialMemberIDsFromRequest || ghostMemberIDs, 'should be set');
    for (const memberID of memberIDs) {
      const member = fetchMemberIDs[memberID];
      if (
        !member &&
        shouldCreateRelationships &&
        (threadType !== threadTypes.SIDEBAR ||
          parentThreadMembers?.includes(memberID))
      ) {
        viewerNeedsRelationshipsWith.push(memberID);
        continue;
      } else if (!member && silentlyFailMembers) {
        silencedMemberIDs.add(memberID);
        continue;
      } else if (!member) {
        throw new ServerError('invalid_credentials');
      }

      const { relationshipStatus } = member;
      const memberRelationshipHasBlock = !!(
        relationshipStatus &&
        relationshipBlockedInEitherDirection(relationshipStatus)
      );
      if (
        relationshipStatus === userRelationshipStatus.FRIEND &&
        threadType !== threadTypes.SIDEBAR
      ) {
        continue;
      } else if (memberRelationshipHasBlock && silentlyFailMembers) {
        silencedMemberIDs.add(memberID);
      } else if (memberRelationshipHasBlock) {
        throw new ServerError('invalid_credentials');
      } else if (
        parentThreadMembers &&
        parentThreadMembers.includes(memberID)
      ) {
        continue;
      } else if (!shouldCreateRelationships && silentlyFailMembers) {
        silencedMemberIDs.add(memberID);
      } else if (!shouldCreateRelationships) {
        throw new ServerError('invalid_credentials');
      }
    }
  }

  const filteredInitialMemberIDs: ?$ReadOnlyArray<string> = initialMemberIDsFromRequest?.filter(
    (id) => !silencedMemberIDs.has(id),
  );
  const initialMemberIDs =
    filteredInitialMemberIDs && filteredInitialMemberIDs.length > 0
      ? filteredInitialMemberIDs
      : null;

  const [id] = await createIDs('threads', 1);
  const newRoles = await createInitialRolesForNewThread(id, threadType);

  const name = request.name ? request.name : null;
  const description = request.description ? request.description : null;
  let color = request.color
    ? request.color.toLowerCase()
    : generateRandomColor();
  if (threadType === threadTypes.PERSONAL) {
    color = generatePendingThreadColor(
      request.initialMemberIDs ?? [],
      viewer.id,
    );
  }

  const time = Date.now();

  const row = [
    id,
    threadType,
    name,
    description,
    viewer.userID,
    time,
    color,
    parentThreadID,
    newRoles.default.id,
    sourceMessageID,
  ];
  if (threadType === threadTypes.PERSONAL) {
    const otherMemberID = initialMemberIDs?.[0];
    invariant(
      otherMemberID,
      'Other member id should be set for a PERSONAL thread',
    );
    const query = SQL`
      INSERT INTO threads(id, type, name, description, creator,
        creation_time, color, parent_thread_id, default_role, source_message)
      SELECT ${row}
      WHERE NOT EXISTS (
        SELECT * 
        FROM threads t
        INNER JOIN memberships m1 
          ON m1.thread = t.id AND m1.user = ${viewer.userID}
        INNER JOIN memberships m2
          ON m2.thread = t.id AND m2.user = ${otherMemberID}
        WHERE t.type = ${threadTypes.PERSONAL}
          AND m1.role != -1
          AND m2.role != -1
      )
    `;
    const [result] = await dbQuery(query);

    if (result.affectedRows === 0) {
      const personalThreadQuery = SQL`
        SELECT t.id 
        FROM threads t
        INNER JOIN memberships m1 
          ON m1.thread = t.id AND m1.user = ${viewer.userID}
        INNER JOIN memberships m2
          ON m2.thread = t.id AND m2.user = ${otherMemberID}
        WHERE t.type = ${threadTypes.PERSONAL}
          AND m1.role != -1
          AND m2.role != -1
      `;
      const deleteRoles = SQL`
        DELETE FROM roles
        WHERE id IN (${newRoles.default.id}, ${newRoles.creator.id})
      `;
      const deleteIDs = SQL`
        DELETE FROM ids
        WHERE id IN (${id}, ${newRoles.default.id}, ${newRoles.creator.id})
      `;
      const [[personalThreadResult]] = await Promise.all([
        dbQuery(personalThreadQuery),
        dbQuery(deleteRoles),
        dbQuery(deleteIDs),
      ]);
      invariant(
        personalThreadResult.length > 0,
        'PERSONAL thread should exist',
      );
      const personalThreadID = personalThreadResult[0].id.toString();

      return {
        newThreadID: personalThreadID,
        updatesResult: {
          newUpdates: [],
        },
        userInfos: {},
        newMessageInfos: [],
      };
    }
  } else {
    const query = SQL`
      INSERT INTO threads(id, type, name, description, creator,
        creation_time, color, parent_thread_id, default_role, source_message)
      VALUES ${[row]}
    `;
    await dbQuery(query);
  }

  const [
    creatorChangeset,
    initialMembersChangeset,
    ghostMembersChangeset,
    recalculatePermissionsChangeset,
  ] = await Promise.all([
    changeRole(id, [viewer.userID], newRoles.creator.id),
    initialMemberIDs ? changeRole(id, initialMemberIDs, null) : undefined,
    ghostMemberIDs ? changeRole(id, ghostMemberIDs, -1) : undefined,
    recalculateAllPermissions(id, threadType),
  ]);

  if (!creatorChangeset) {
    throw new ServerError('unknown_error');
  }
  const {
    membershipRows: creatorMembershipRows,
    relationshipRows: creatorRelationshipRows,
  } = creatorChangeset;

  const {
    membershipRows: recalculateMembershipRows,
    relationshipRows: recalculateRelationshipRows,
  } = recalculatePermissionsChangeset;

  const membershipRows = [
    ...creatorMembershipRows,
    ...recalculateMembershipRows,
  ];
  const relationshipRows = [
    ...creatorRelationshipRows,
    ...recalculateRelationshipRows,
  ];
  if (initialMemberIDs || ghostMemberIDs) {
    if (!initialMembersChangeset && !ghostMembersChangeset) {
      throw new ServerError('unknown_error');
    }
    relationshipRows.push(
      ...getRelationshipRowsForUsers(
        viewer.userID,
        viewerNeedsRelationshipsWith,
      ),
    );
    const membersMembershipRows = [];
    const membersRelationshipRows = [];
    if (initialMembersChangeset) {
      const {
        membershipRows: initialMembersMembershipRows,
        relationshipRows: initialMembersRelationshipRows,
      } = initialMembersChangeset;
      membersMembershipRows.push(...initialMembersMembershipRows);
      membersRelationshipRows.push(...initialMembersRelationshipRows);
    }

    if (ghostMembersChangeset) {
      const {
        membershipRows: ghostMembersMembershipRows,
        relationshipRows: ghostMembersRelationshipRows,
      } = ghostMembersChangeset;
      membersMembershipRows.push(...ghostMembersMembershipRows);
      membersRelationshipRows.push(...ghostMembersRelationshipRows);
    }

    const memberAndCreatorIDs = [...memberIDs, viewer.userID];
    const parentRelationshipRows = getParentThreadRelationshipRowsForNewUsers(
      id,
      recalculateMembershipRows,
      memberAndCreatorIDs,
    );
    membershipRows.push(...membersMembershipRows);
    relationshipRows.push(
      ...membersRelationshipRows,
      ...parentRelationshipRows,
    );
  }

  setJoinsToUnread(membershipRows, viewer.userID, id);

  const changeset = { membershipRows, relationshipRows };
  const {
    threadInfos,
    viewerUpdates,
    userInfos,
  } = await commitMembershipChangeset(viewer, changeset, {
    updatesForCurrentSession,
  });

  const initialMemberAndCreatorIDs = initialMemberIDs
    ? [...initialMemberIDs, viewer.userID]
    : [viewer.userID];
  const messageDatas = [];
  if (threadType !== threadTypes.SIDEBAR) {
    messageDatas.push({
      type: messageTypes.CREATE_THREAD,
      threadID: id,
      creatorID: viewer.userID,
      time,
      initialThreadState: {
        type: threadType,
        name,
        parentThreadID,
        color,
        memberIDs: initialMemberAndCreatorIDs,
      },
    });
  } else {
    invariant(parentThreadID, 'parentThreadID should be set for sidebar');
    if (!sourceMessage || sourceMessage.type === messageTypes.SIDEBAR_SOURCE) {
      throw new ServerError('invalid_parameters');
    }

    messageDatas.push(
      {
        type: messageTypes.CREATE_SIDEBAR,
        threadID: id,
        creatorID: viewer.userID,
        time,
        sourceMessageAuthorID: sourceMessage.creatorID,
        initialThreadState: {
          name,
          parentThreadID,
          color,
          memberIDs: initialMemberAndCreatorIDs,
        },
      },
      {
        type: messageTypes.SIDEBAR_SOURCE,
        threadID: id,
        creatorID: viewer.userID,
        time,
        sourceMessage,
      },
    );
  }

  if (parentThreadID && threadType !== threadTypes.SIDEBAR) {
    messageDatas.push({
      type: messageTypes.CREATE_SUB_THREAD,
      threadID: parentThreadID,
      creatorID: viewer.userID,
      time,
      childThreadID: id,
    });
  }
  const newMessageInfos = await createMessages(
    viewer,
    messageDatas,
    updatesForCurrentSession,
  );

  if (hasMinCodeVersion(viewer.platformDetails, 62)) {
    return {
      newThreadID: id,
      updatesResult: {
        newUpdates: viewerUpdates,
      },
      userInfos,
      newMessageInfos,
    };
  }

  return {
    newThreadInfo: threadInfos[id],
    updatesResult: {
      newUpdates: viewerUpdates,
    },
    userInfos,
    newMessageInfos,
  };
}

function createPrivateThread(
  viewer: Viewer,
  username: string,
): Promise<NewThreadResponse> {
  return createThread(
    viewer,
    {
      type: threadTypes.PRIVATE,
      name: username,
      description: privateThreadDescription,
      ghostMemberIDs: [squadbot.userID],
    },
    {
      forceAddMembers: true,
    },
  );
}

export { createThread, createPrivateThread, privateThreadDescription };
