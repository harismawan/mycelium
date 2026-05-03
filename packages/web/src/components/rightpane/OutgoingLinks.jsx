import React from 'react';
import styled from 'styled-components';
import { PaneSection, SectionTitle, MutedText, StyledLink } from '../../styles/shared.js';

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const LinkItem = styled.li`
  margin-bottom: 2px;
`;

/**
 * Extract all `[[Wikilink]]` titles from content.
 * @param {string} content
 * @returns {string[]}
 */
function extractWikilinks(content) {
  const regex = /\[\[([^\]]+)\]\]/g;
  const titles = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    const title = m[1].trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

/**
 * Display a note's outgoing wikilinks as clickable navigation items.
 *
 * @param {{ note: { content?: string } | null }} props
 * @returns {React.JSX.Element}
 */
export default function OutgoingLinks({ note }) {
  const links = note?.content ? extractWikilinks(note.content) : [];

  return (
    <PaneSection>
      <SectionTitle>Related to</SectionTitle>
      {links.length === 0 && <MutedText>No outgoing links</MutedText>}
      {links.length > 0 && (
        <List>
          {links.map((title) => {
            const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
            return (
              <LinkItem key={title}>
                <StyledLink to={`/notes/${slug}`}>{title}</StyledLink>
              </LinkItem>
            );
          })}
        </List>
      )}
    </PaneSection>
  );
}
